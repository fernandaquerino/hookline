import type { IncomingHttpHeaders } from 'node:http';
import type { SignatureStatus } from '@hookline/db';

export interface IngestInput {
  method: string;
  path: string;
  query: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type IngestResult =
  | {
      kind: 'accepted';
      requestId: string;
      signatureStatus: SignatureStatus;
      deliveryIds: string[];
    }
  | { kind: 'duplicate'; requestId: string | null };
