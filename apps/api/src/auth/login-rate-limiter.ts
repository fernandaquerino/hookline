/**
 * Fixed-window limiter for login attempts per client address. In-memory, so it is per process;
 * good enough for a single-admin development tool.
 */
export class LoginRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 60_000,
  ) {}

  /** Records an attempt and returns false when the client is over the limit. */
  tryAcquire(key: string, nowMs: number = Date.now()): boolean {
    const window = this.windows.get(key);
    if (!window || nowMs - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: nowMs, count: 1 });
      this.prune(nowMs);
      return true;
    }
    window.count++;
    return window.count <= this.maxAttempts;
  }

  private prune(nowMs: number): void {
    if (this.windows.size < 1_000) return;
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
