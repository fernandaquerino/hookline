import { type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@hookline/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import { ApiException } from './api-exception';

/** Validates and parses a request part with a zod schema; errors become VALIDATION_FAILED. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const message = result.error.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      )
      .join('; ');
    throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, message);
  }
}
