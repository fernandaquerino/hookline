import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@hookline/shared';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { LoginRateLimiter } from './login-rate-limiter';
import { verifyPassword } from './password';
import { createSessionToken } from './session';

@Injectable()
export class AuthService {
  private readonly limiter = new LoginRateLimiter();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Returns a session token for the right password; throws otherwise. */
  async login(password: string, clientKey: string): Promise<string> {
    if (!this.limiter.tryAcquire(clientKey)) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.TOO_MANY_REQUESTS,
        'Too many sign-in attempts; wait a minute and try again',
      );
    }
    const ok = await verifyPassword(password, this.config.adminPasswordHash);
    if (!ok) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Wrong password',
      );
    }
    return createSessionToken(this.config.sessionSecret);
  }

  get secureCookies(): boolean {
    return this.config.nodeEnv === 'production';
  }
}
