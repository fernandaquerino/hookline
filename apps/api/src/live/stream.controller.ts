import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EndpointsService } from '../endpoints/endpoints.service';
import { LiveEventsService } from './live-events.service';

const HEARTBEAT_MS = 15_000;

/** `GET /api/endpoints/:id/stream`: Server-Sent Events for new requests and delivery updates. */
@Controller('api/endpoints/:id/stream')
export class StreamController {
  constructor(
    private readonly endpoints: EndpointsService,
    private readonly live: LiveEventsService,
  ) {}

  @Get()
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.endpoints.assertExists(id);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // Ask EventSource to wait 2 s before reconnecting, and tell the client the stream is live.
    res.write('retry: 2000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ endpointId: id })}\n\n`);

    const unsubscribe = this.live.subscribe(id, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }
}
