import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

export interface StubResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  /** Wait this long before answering (to trigger timeouts). */
  delayMs?: number;
}

/** A local HTTP server that records requests and answers from a scripted list of responses. */
export class StubServer {
  readonly received: ReceivedRequest[] = [];
  private readonly script: StubResponse[] = [];
  private fallback: StubResponse = { status: 200, body: 'ok' };
  private readonly server = createServer((req, res) => void this.handle(req, res));

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/hook`;
  }

  /** Responses are used in order; once exhausted, `fallback` answers. */
  respondWith(...responses: StubResponse[]): this {
    this.script.push(...responses);
    return this;
  }

  setFallback(response: StubResponse): this {
    this.fallback = response;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    this.received.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    const response = this.script.shift() ?? this.fallback;
    if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));
    if (res.destroyed) return;
    res.writeHead(response.status, response.headers);
    res.end(response.body ?? '');
  }
}

export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
