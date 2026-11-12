import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { type LoginInput, loginInput } from '@hookline/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { clearedSessionCookie, sessionCookie } from './session';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body(new ZodValidationPipe(loginInput)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = await this.auth.login(body.password, req.ip ?? 'unknown');
    res.setHeader('Set-Cookie', sessionCookie(token, this.auth.secureCookies));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.setHeader('Set-Cookie', clearedSessionCookie(this.auth.secureCookies));
  }

  /** Lets the dashboard check whether its cookie is still valid. */
  @Get('session')
  session(): { authenticated: true } {
    return { authenticated: true };
  }
}
