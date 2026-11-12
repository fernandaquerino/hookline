import { z } from 'zod';

export const SIGNING_SCHEMES = ['none', 'generic_sha256', 'github', 'stripe'] as const;
export const SIGNATURE_STATUSES = ['valid', 'invalid', 'not_configured'] as const;
export const DELIVERY_STATUSES = [
  'PENDING',
  'IN_FLIGHT',
  'SUCCEEDED',
  'FAILED_RETRYING',
  'DEAD',
] as const;

export type SigningSchemeName = (typeof SIGNING_SCHEMES)[number];
export type SignatureStatusName = (typeof SIGNATURE_STATUSES)[number];
export type DeliveryStatusName = (typeof DELIVERY_STATUSES)[number];

/** HTTP header names: RFC 9110 token characters. */
const headerName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'must be a valid HTTP header name')
  .transform((value) => value.toLowerCase());

const name = z.string().trim().min(1, 'is required').max(100);
const secret = z.string().min(1, 'must not be empty').max(500);

export const createEndpointInput = z
  .object({
    name,
    signingScheme: z.enum(SIGNING_SCHEMES).default('none'),
    signingSecret: secret.optional(),
    dedupeHeader: headerName.nullable().optional(),
    forwardInvalidSignatures: z.boolean().default(false),
  })
  .strict()
  .refine((input) => input.signingScheme === 'none' || input.signingSecret !== undefined, {
    message: 'signingSecret is required when signingScheme is not none',
    path: ['signingSecret'],
  });
export type CreateEndpointInput = z.input<typeof createEndpointInput>;

export const updateEndpointInput = z
  .object({
    name: name.optional(),
    signingScheme: z.enum(SIGNING_SCHEMES).optional(),
    /** A new secret; omit to keep the current one. */
    signingSecret: secret.optional(),
    dedupeHeader: headerName.nullable().optional(),
    forwardInvalidSignatures: z.boolean().optional(),
  })
  .strict();
export type UpdateEndpointInput = z.input<typeof updateEndpointInput>;

export const DESTINATION_LIMITS = {
  timeoutMs: { min: 100, max: 60_000, default: 10_000 },
  maxAttempts: { min: 1, max: 20, default: 8 },
} as const;

const destinationUrl = z.string().trim().url('must be a valid URL').max(2_000);
const timeoutMs = z
  .number()
  .int()
  .min(DESTINATION_LIMITS.timeoutMs.min)
  .max(DESTINATION_LIMITS.timeoutMs.max);
const maxAttempts = z
  .number()
  .int()
  .min(DESTINATION_LIMITS.maxAttempts.min)
  .max(DESTINATION_LIMITS.maxAttempts.max);

export const createDestinationInput = z
  .object({
    url: destinationUrl,
    enabled: z.boolean().default(true),
    timeoutMs: timeoutMs.default(DESTINATION_LIMITS.timeoutMs.default),
    maxAttempts: maxAttempts.default(DESTINATION_LIMITS.maxAttempts.default),
  })
  .strict();
export type CreateDestinationInput = z.input<typeof createDestinationInput>;

export const updateDestinationInput = z
  .object({
    url: destinationUrl.optional(),
    enabled: z.boolean().optional(),
    timeoutMs: timeoutMs.optional(),
    maxAttempts: maxAttempts.optional(),
  })
  .strict();
export type UpdateDestinationInput = z.input<typeof updateDestinationInput>;

export const loginInput = z.object({ password: z.string().min(1).max(1_000) }).strict();
export type LoginInput = z.infer<typeof loginInput>;

export const REQUEST_PAGE_LIMIT = { default: 50, max: 100 } as const;

export const listRequestsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REQUEST_PAGE_LIMIT.max)
    .default(REQUEST_PAGE_LIMIT.default),
  signatureStatus: z.enum(SIGNATURE_STATUSES).optional(),
  deliveryStatus: z.enum(DELIVERY_STATUSES).optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuery>;

export const listDeliveriesQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REQUEST_PAGE_LIMIT.max)
    .default(REQUEST_PAGE_LIMIT.default),
  status: z.enum(DELIVERY_STATUSES).default('DEAD'),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuery>;

export const BULK_REPLAY_MAX = 100;

export const bulkReplayInput = z
  .object({ deliveryIds: z.array(z.string().uuid()).min(1).max(BULK_REPLAY_MAX) })
  .strict();
export type BulkReplayInput = z.infer<typeof bulkReplayInput>;
