import type { OnModuleDestroy } from '@nestjs/common';
import { Agent, type Dispatcher, request } from 'undici';

export const RESPONSE_SNIPPET_BYTES = 2 * 1024;

export interface OutgoingRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  timeoutMs: number;
}

export type SendResult =
  | {
      kind: 'response';
      status: number;
      retryAfter: string | null;
      bodySnippet: string;
      durationMs: number;
    }
  | {
      kind: 'error';
      error: string;
      durationMs: number;
      /** True when the destination was refused before connecting (SSRF guard). */
      blocked: boolean;
    };

/** Sends one delivery attempt. Never throws for network-level failures. */
export abstract class HttpSender {
  abstract send(req: OutgoingRequest): Promise<SendResult>;
}

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

/**
 * Reads at most `limit` bytes of a response body, then discards the rest. A body that fails or
 * stalls mid-read keeps what arrived: the status code already decided the outcome.
 */
async function readSnippet(body: Dispatcher.ResponseData['body'], limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      chunks.push(buffer);
      size += buffer.length;
      if (size >= limit) break;
    }
  } catch {
    // Keep the partial snippet.
  } finally {
    body.destroy();
  }
  return Buffer.concat(chunks).subarray(0, limit).toString('utf8');
}

export function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `Timeout after ${timeoutMs} ms`;
    }
    const code = (error as { code?: unknown }).code;
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return typeof code === 'string'
      ? `${code}: ${error.message}${cause}`
      : `${error.message}${cause}`;
  }
  return String(error);
}

/** undici-based sender. Redirects are not followed; a 3xx is reported as-is. */
export class UndiciHttpSender extends HttpSender implements OnModuleDestroy {
  constructor(private readonly dispatcher: Dispatcher = new Agent()) {
    super();
  }

  async send(req: OutgoingRequest): Promise<SendResult> {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    try {
      const response = await request(req.url, {
        method: req.method as Dispatcher.HttpMethod,
        headers: req.headers,
        body: METHODS_WITHOUT_BODY.has(req.method.toUpperCase()) ? undefined : req.body,
        dispatcher: this.dispatcher,
        headersTimeout: req.timeoutMs,
        bodyTimeout: req.timeoutMs,
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      const bodySnippet = await readSnippet(response.body, RESPONSE_SNIPPET_BYTES);
      const retryAfter = response.headers['retry-after'];
      return {
        kind: 'response',
        status: response.statusCode,
        retryAfter: (Array.isArray(retryAfter) ? retryAfter[0] : retryAfter) ?? null,
        bodySnippet,
        durationMs: elapsed(),
      };
    } catch (error) {
      return {
        kind: 'error',
        error: describeError(error, req.timeoutMs),
        durationMs: elapsed(),
        blocked: false,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatcher.close();
  }
}
