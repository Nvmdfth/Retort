import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';
import { timingSafeEqual, createHash } from 'crypto';

const DEFAULT_ADMIN_SECRETS = ['retortadmin', 'change-me', 'changeme', 'admin', 'password'];
const MIN_PROD_SECRET_LENGTH = 8;

export function isSecretValid(input: string, expected: string): boolean {
  const normInput = input.trim();
  const normExpected = expected.trim().replace(/^["']|["']$/g, '');

  if (!normInput || !normExpected) return false;

  const hashInput = createHash('sha256').update(normInput).digest();
  const hashExpected = createHash('sha256').update(normExpected).digest();

  return timingSafeEqual(hashInput, hashExpected);
}

/**
 * Resolves the admin secret. In production an unset, default or short secret is fatal;
 * outside production the legacy dev default is kept so local runs and tests still work.
 */
export function resolveAdminSecret(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.ADMIN_SECRET || '').trim().replace(/^["']|["']$/g, '');
  if (env.NODE_ENV === 'production') {
    if (!raw || DEFAULT_ADMIN_SECRETS.includes(raw.toLowerCase()) || raw.length < MIN_PROD_SECRET_LENGTH) {
      throw new Error(
        `ADMIN_SECRET must be set to a non-default value of at least ${MIN_PROD_SECRET_LENGTH} characters in production`
      );
    }
    return raw;
  }
  return raw || 'RetortAdmin';
}

/**
 * Client IP for rate limiting. Proxy headers are spoofable by any direct caller,
 * so they are only honored when TRUST_PROXY=1 (i.e. a trusted proxy sets them).
 */
export function getClientIp(socket: Socket, env: Record<string, string | undefined> = process.env): string {
  if (env.TRUST_PROXY === '1') {
    const cfIp = socket.handshake.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
    const xff = socket.handshake.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      return xff.split(',')[0].trim();
    }
  }
  return socket.handshake.address || socket.id;
}

/**
 * Cross-origin allowlist: same-origin, localhost, and anything in ALLOWED_ORIGINS
 * (comma-separated, exact match). Requests without an Origin header (non-browser clients) pass.
 */
export function isOriginAllowed(req: IncomingMessage, env: Record<string, string | undefined> = process.env): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {
    return false;
  }

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;

  const custom = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return custom.includes(origin);
}

/** Sliding-window counter keyed by string (IP). */
export class SlidingWindowLimiter {
  private hits: Map<string, number[]> = new Map();

  constructor(private max: number, private windowMs: number) {}

  /** Records a hit; returns false when the key is over its limit. */
  public hit(key: string, now = Date.now()): boolean {
    const recent = this.recent(key, now);
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  public isLimited(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  public sweep(now = Date.now()) {
    for (const key of this.hits.keys()) {
      const recent = this.recent(key, now);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) || []).filter((ts) => now - ts < this.windowMs);
  }
}

/** Failed-attempt counter with a timed lockout. */
export class AuthLockout {
  private attempts: Map<string, { count: number; lockedUntil: number }> = new Map();

  constructor(private maxFailures = 5, private lockMs = 60000) {}

  /** Seconds remaining on an active lockout, or 0. */
  public lockedSeconds(key: string, now = Date.now()): number {
    const a = this.attempts.get(key);
    return a && a.lockedUntil > now ? Math.ceil((a.lockedUntil - now) / 1000) : 0;
  }

  public fail(key: string, now = Date.now()) {
    const count = (this.attempts.get(key)?.count || 0) + 1;
    this.attempts.set(key, { count, lockedUntil: count >= this.maxFailures ? now + this.lockMs : 0 });
  }

  public clear(key: string) {
    this.attempts.delete(key);
  }

  public sweep(now = Date.now()) {
    for (const [key, a] of this.attempts.entries()) {
      if (a.lockedUntil < now && a.count > 0) this.attempts.delete(key);
    }
  }
}
