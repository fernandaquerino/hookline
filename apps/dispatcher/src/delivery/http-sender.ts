import type { OnModuleDestroy } from '@nestjs/common';
import {
  type Resolver,
  checkDestinationUrl,
  createGuardedLookup,
  isDestinationNotAllowed,
} from '@hookline/ssrf';
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

function guardMessage(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: unknown }).code === 'DESTINATION_NOT_ALLOWED') return current.message;
    current = current.cause;
  }
  return String(error);
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

export interface SenderOptions {
  allowPrivateDestinations: boolean;
  /** DNS resolver override, for tests. */
  resolver?: Resolver;
}

/**
 * undici-based sender with the SSRF guard. IP-literal URLs are checked up front (they never hit
 * DNS); hostnames are checked by the agent's connect-time lookup, so the socket connects to the
 * very address that passed the check. Redirects are not followed; a 3xx is reported as-is.
 */
export class UndiciHttpSender extends HttpSender implements OnModuleDestroy {
  private readonly dispatcher: Dispatcher;

  constructor(private readonly options: SenderOptions) {
    super();
    this.dispatcher = new Agent({
      connect: {
        lookup: createGuardedLookup({
          allowPrivate: options.allowPrivateDestinations,
          resolver: options.resolver,
        }),
      },
    });
  }

  async send(req: OutgoingRequest): Promise<SendResult> {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    try {
      checkDestinationUrl(req.url, this.options.allowPrivateDestinations);
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
      const blocked = isDestinationNotAllowed(error);
      return {
        kind: 'error',
        error: blocked
          ? `DESTINATION_NOT_ALLOWED: ${guardMessage(error)}`
          : describeError(error, req.timeoutMs),
        durationMs: elapsed(),
        blocked,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispatcher.close();
  }
}
