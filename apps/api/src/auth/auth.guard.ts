import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@hookline/shared';
import type { Request } from 'express';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IS_PUBLIC } from './public.decorator';
import { SESSION_COOKIE, readCookie, verifySessionToken } from './session';

/** Global guard: every route needs a valid session cookie unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (verifySessionToken(token, this.config.sessionSecret)) return true;
    throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, 'Sign in required');
  }
}
