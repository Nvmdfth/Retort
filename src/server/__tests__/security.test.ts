import { describe, expect, test } from 'bun:test';
import type { IncomingMessage } from 'http';
import { resolveAdminSecret, isOriginAllowed, SlidingWindowLimiter, AuthLockout } from '../security';
import rawPrompts from '../prompts.json';
import rawSafetyQuips from '../safetyQuips.json';
import rawRoasts from '../roasts.json';
import { GameEngine } from '../gameEngine';
import type { Player } from '../../types/game';

const req = (origin?: string, host = 'game.example:9847') =>
  ({ headers: { origin, host } }) as unknown as IncomingMessage;

describe('resolveAdminSecret', () => {
  test('production rejects unset, default and short secrets', () => {
    for (const secret of [undefined, '', 'RetortAdmin', 'change-me', 'short']) {
      expect(() => resolveAdminSecret({ NODE_ENV: 'production', ADMIN_SECRET: secret })).toThrow();
    }
  });
  test('production accepts a strong secret; dev falls back to the legacy default', () => {
    expect(resolveAdminSecret({ NODE_ENV: 'production', ADMIN_SECRET: 'a-long-random-secret' })).toBe('a-long-random-secret');
    expect(resolveAdminSecret({ NODE_ENV: 'development' })).toBe('RetortAdmin');
  });
});

describe('isOriginAllowed', () => {
  test('allows no-origin, same-origin and localhost', () => {
    expect(isOriginAllowed(req(undefined), {})).toBe(true);
    expect(isOriginAllowed(req('http://game.example:9847'), {})).toBe(true);
    expect(isOriginAllowed(req('http://localhost:3000'), {})).toBe(true);
  });
  test('blocks other LAN/third-party origins unless in ALLOWED_ORIGINS', () => {
    expect(isOriginAllowed(req('http://192.168.1.50:8080'), {})).toBe(false);
    expect(isOriginAllowed(req('https://evil.com'), {})).toBe(false);
    expect(isOriginAllowed(req('https://tv.example.com'), { ALLOWED_ORIGINS: 'https://tv.example.com' })).toBe(true);
  });
});

describe('limiters', () => {
  test('SlidingWindowLimiter caps hits inside the window and recovers', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    expect(l.hit('a', 0)).toBe(true);
    expect(l.hit('a', 1)).toBe(true);
    expect(l.hit('a', 2)).toBe(false);
    expect(l.hit('a', 1500)).toBe(true);
  });
  test('AuthLockout locks after max failures', () => {
    const l = new AuthLockout(2, 1000);
    l.fail('ip', 0);
    expect(l.lockedSeconds('ip', 1)).toBe(0);
    l.fail('ip', 2);
    expect(l.lockedSeconds('ip', 3)).toBe(1);
    l.clear('ip');
    expect(l.lockedSeconds('ip', 3)).toBe(0);
  });
});

describe('content integrity', () => {
  const lists: Record<string, string[]> = {
    prompts: rawPrompts as string[],
    safetyQuips: rawSafetyQuips as string[],
  };
  for (const [name, list] of Object.entries(lists)) {
    test(`${name}: non-empty, trimmed, bounded, unique`, () => {
      expect(list.length).toBeGreaterThan(0);
      for (const t of list) {
        expect(typeof t).toBe('string');
        expect(t).toBe(t.trim());
        expect(t.length).toBeGreaterThan(0);
        expect(t.length).toBeLessThanOrEqual(200);
      }
      expect(new Set(list.map((t) => t.toLowerCase())).size).toBe(list.length);
    });
  }
  test('roasts: forfeit and safety_quip outcomes exist', () => {
    expect(rawRoasts.outcomes.forfeit.length).toBeGreaterThan(0);
    expect(rawRoasts.outcomes.safety_quip.length).toBeGreaterThan(0);
  });
});

describe('prompt dealing', () => {
  test('consecutive rounds do not repeat prompts', () => {
    const mk = (id: string, host = false): Player => ({
      id, sessionToken: id, nickname: id, avatarSeed: id, score: 0, isHost: host, isConnected: true, hasSubmitted: false,
    });
    let room = GameEngine.createRoom('ABCD', mk('p1', true));
    room.players.p2 = mk('p2');
    room.players.p3 = mk('p3');
    room = GameEngine.startWritingPhase(room);
    const first = room.prompts.map((p) => p.text);
    room.round = 2;
    room = GameEngine.startWritingPhase(room);
    const overlap = room.prompts.map((p) => p.text).filter((t) => first.includes(t));
    expect(overlap).toEqual([]);
  });
});
