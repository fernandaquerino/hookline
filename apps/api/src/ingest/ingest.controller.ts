import { All, Controller, HttpStatus, Inject, Param, Req, Res } from '@nestjs/common';
import { ErrorCode } from '@hookline/shared';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IngestService } from './ingest.service';
import { PayloadTooLargeError, readRawBody } from './raw-body';

/** `ANY /in/:slug`: store the request and answer immediately; delivery happens asynchronously. */
@Public()
@Controller('in')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @All(':slug')
  async receive(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const endpoint = await this.ingest.findEndpoint(slug);
    const body = await this.readBody(req, res);
    const queryIndex = req.originalUrl.indexOf('?');
    const result = await this.ingest.ingest(endpoint, {
      method: req.method,
      path: req.path,
      query: queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex + 1),
      headers: req.headers,
      body,
    });

    if (result.kind === 'duplicate') {
      res.status(HttpStatus.OK);
      return { id: result.requestId, duplicate: true };
    }
    res.status(HttpStatus.ACCEPTED);
    return {
      id: result.requestId,
      signatureStatus: result.signatureStatus,
      deliveries: result.deliveryIds.length,
    };
  }

  private async readBody(req: Request, res: Response): Promise<Buffer> {
    try {
      return await readRawBody(req, this.config.maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        res.setHeader('Connection', 'close');
        throw new ApiException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          ErrorCode.PAYLOAD_TOO_LARGE,
          `Payload exceeds ${this.config.maxBodyBytes} bytes`,
        );
      }
      throw error;
    }
  }
}
