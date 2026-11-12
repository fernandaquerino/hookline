/** Stable error codes returned by the API as `{ code, message }`. */
export const ErrorCode = {
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DESTINATION_NOT_ALLOWED: 'DESTINATION_NOT_ALLOWED',
  DELIVERY_NOT_REPLAYABLE: 'DELIVERY_NOT_REPLAYABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: string;
  message: string;
}
