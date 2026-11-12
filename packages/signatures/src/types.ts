export type SigningScheme = 'none' | 'generic_sha256' | 'github' | 'stripe';

export type SignatureStatus = 'valid' | 'invalid' | 'not_configured';

/** Incoming request headers. Names are matched case-insensitively. */
export type HeaderMap = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyInput {
  scheme: SigningScheme;
  /** Plain-text signing secret. Null or empty means no secret is configured. */
  secret: string | null;
  headers: HeaderMap;
  /** Raw request body exactly as received. */
  body: Buffer;
  /** Current time in milliseconds; injectable for tests. Defaults to Date.now(). */
  nowMs?: number;
  /** Stripe timestamp tolerance in seconds. Defaults to 300. */
  toleranceSeconds?: number;
}

export interface VerifyResult {
  status: SignatureStatus;
  /** Human-readable reason when the status is not `valid`. */
  reason?: string;
}
