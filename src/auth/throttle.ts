/**
 * Failed-login throttle keyed by (ip, username).
 *
 * Every wrong password here becomes a wrong bind on the directory, and the directory locks the
 * network account after its own threshold. Without this, the training app would be a convenient
 * way to lock a colleague out of their whole workstation. The app's limit (5) sits below the
 * directory's, and only *wrong password* outcomes count: "directory unreachable" never does.
 */
export interface ThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, { n: number; since: number }>();
  readonly maxFailures: number;
  readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: ThrottleOptions = {}) {
    this.maxFailures = opts.maxFailures ?? 5;
    this.windowMs = opts.windowMs ?? 15 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  static key(ip: string | null, username: string): string {
    return `${ip ?? "-"}|${username.trim().toLowerCase()}`;
  }

  /** Milliseconds until the key may try again, or 0 when it is not blocked. */
  blockedFor(key: string): number {
    const f = this.failures.get(key);
    if (!f) return 0;
    const elapsed = this.now() - f.since;
    if (elapsed >= this.windowMs) {
      this.failures.delete(key);
      return 0;
    }
    return f.n >= this.maxFailures ? this.windowMs - elapsed : 0;
  }

  fail(key: string): void {
    const t = this.now();
    // Opportunistic cleanup keeps the map bounded without a timer.
    for (const [k, f] of this.failures) if (t - f.since >= this.windowMs) this.failures.delete(k);
    const f = this.failures.get(key);
    if (f) f.n += 1;
    else this.failures.set(key, { n: 1, since: t });
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  get size(): number {
    return this.failures.size;
  }
}
