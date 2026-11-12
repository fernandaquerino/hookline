import { ErrorCode } from '@hookline/shared';
import { ApiException } from './api-exception';

export interface Cursor {
  at: Date;
  id: string;
}

/** Opaque keyset cursor over (timestamp DESC, id DESC). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, 'cursor is invalid');
  }
  return { at: date, id };
}
