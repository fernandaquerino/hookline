export const DESTINATION_NOT_ALLOWED = 'DESTINATION_NOT_ALLOWED';

/** Thrown (or passed to lookup callbacks) when a destination is refused by the SSRF guard. */
export class DestinationNotAllowedError extends Error {
  readonly code = DESTINATION_NOT_ALLOWED;

  constructor(message: string) {
    super(message);
    this.name = 'DestinationNotAllowedError';
  }
}

/** True if the error, or any error in its `cause` chain, came from the SSRF guard. */
export function isDestinationNotAllowed(error: unknown): error is Error {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    if ((current as { code?: unknown }).code === DESTINATION_NOT_ALLOWED) return true;
    current = current.cause;
  }
  return false;
}
