import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@hookline/shared';
import { assertDestinationAllowed, isDestinationNotAllowed, type Resolver } from '@hookline/ssrf';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const DNS_RESOLVER = Symbol('DNS_RESOLVER');

/**
 * Save-time SSRF check. It gives early feedback; the dispatcher checks again at delivery time,
 * because DNS answers can change after saving.
 */
@Injectable()
export class DestinationPolicy {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DNS_RESOLVER) private readonly resolver: Resolver | undefined,
  ) {}

  async assertAllowed(url: string): Promise<void> {
    try {
      await assertDestinationAllowed(url, {
        allowPrivate: this.config.allowPrivateDestinations,
        resolver: this.resolver,
      });
    } catch (error) {
      if (isDestinationNotAllowed(error)) {
        throw ApiException.badRequest(ErrorCode.DESTINATION_NOT_ALLOWED, (error as Error).message);
      }
      // DNS failures (unknown host) are reported as invalid destinations too.
      throw ApiException.badRequest(
        ErrorCode.DESTINATION_NOT_ALLOWED,
        `Could not resolve destination host: ${(error as Error).message}`,
      );
    }
  }
}
