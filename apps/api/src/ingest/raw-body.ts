import type { IncomingMessage } from 'node:http';

export class PayloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Payload exceeds ${limit} bytes`);
  }
}

/**
 * Reads the raw request body into memory, refusing anything over `limit` bytes. A declared
 * Content-Length over the limit is rejected before any data is read.
 */
export function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new PayloadTooLargeError(limit));
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (error: Error | null, body?: Buffer): void => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (error) {
        // Stop buffering; the remaining bytes are discarded.
        req.resume();
        reject(error);
      } else {
        resolve(body ?? Buffer.alloc(0));
      }
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        finish(new PayloadTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish(null, Buffer.concat(chunks, size));
    const onError = (error: Error): void => finish(error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
