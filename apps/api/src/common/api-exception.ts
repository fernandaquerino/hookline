import { HttpException, HttpStatus } from '@nestjs/common';
import { type ApiError, ErrorCode } from '@hookline/shared';

/** An HTTP error with a stable `{ code, message }` body. */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ code, message } satisfies ApiError, status);
  }

  static notFound(code: ErrorCode, message: string): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, code, message);
  }

  static badRequest(code: ErrorCode, message: string): ApiException {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }

  static conflict(code: ErrorCode, message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, code, message);
  }
}
