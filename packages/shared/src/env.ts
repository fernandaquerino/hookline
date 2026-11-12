import { z } from 'zod';

/** Parses "true"/"false"/"1"/"0" (case-insensitive) environment values. */
export const envBoolean = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => ['true', 'false', '1', '0'].includes(value), {
    message: 'must be true or false',
  })
  .transform((value) => value === 'true' || value === '1');

/** Parses a comma-separated list into trimmed, lower-cased, non-empty entries. */
export const envList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0),
);

/**
 * ALLOW_PRIVATE_DESTINATIONS defaults to true only in development, so a forgotten setting fails
 * closed everywhere else.
 */
export function resolveAllowPrivateDestinations(
  value: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (value === undefined || value.trim() === '') return nodeEnv === 'development';
  return envBoolean.parse(value);
}
