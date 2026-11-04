import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server as HttpServer } from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { GameEngine } from '../gameEngine';
import { setupSocketServer } from '../socketServer';
import type {
  Player,
  RoomState,
  ClientGameState,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../types/game';

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function waitForState(
  socket: TypedClientSocket,
  predicate: (state: ClientGameState) => boolean,
  timeoutMs = 8000
): Promise<ClientGameState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('sync:state', handler);
      reject(new Error(`Timeout waiting for state matching predicate after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (state: ClientGameState) => {
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off('sync:state', handler);
        resolve(state);
      }
    };

    socket.on('sync:state', handler);
  });
}

describe('Security Hardening & OWASP Vulnerability Verification', () => {
  let httpServer: HttpServer;
  let port: number;
  let sock1: TypedClientSocket;
  let sock2: TypedClientSocket;

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1'; // lockout/rate-limit tests drive the client IP via cf-connecting-ip
    httpServer = createServer();
    setupSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (typeof addr === 'object' && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(() => {
    if (sock1?.connected) sock1.disconnect();
    if (sock2?.connected) sock2.disconnect();
    httpServer.close();
  });

  const createMockPlayer = (id: string, nickname: string, isHost = false): Player => ({
    id,
    nickname,
    avatarSeed: id,
    score: 0,
    isHost,
    isConnected: true,
    hasSubmitted: false,
  });

  // =========================================================================
  // 1. Raw Socket Layer Validation & DoS Prevention
  // =========================================================================
  describe('A03:2021 & A04:2021 - Socket Server Validation & DoS Mitigation', () => {
    test('Server rejects malformed non-string payloads over WebSocket without crashing', async () => {
      const url = `http://127.0.0.1:${port}`;
      sock1 = Client(url, { transports: ['websocket'] });
      await new Promise<void>((res) => sock1.on('connect', res));

      // Attempt to crash server with numbers, null, objects, and arrays as nickname
      const malformedPayloads = [
        { nickname: 12345 },
        { nickname: null },
        { nickname: {} },
        { nickname: ['hacked'] },
      ];

      for (const payload of malformedPayloads) {
        const res = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          sock1.emit('room:create', payload as unknown as { nickname: string }, resolve);
        });
        expect(res.ok).toBe(false);
        expect(res.error).toBeDefined();
      }
    });

    test('Server strictly clamps oversized nicknames to 16 characters over raw socket', async () => {
      const hugeNickname = 'SuperLongHackerNameExceedingLimit1234567890';
      const res = await new Promise<{ ok: boolean; roomCode?: string }>((resolve) => {
        sock1.emit('room:create', { nickname: hugeNickname }, resolve);
      });

      expect(res.ok).toBe(true);
      const roomCode = res.roomCode!;

      const state = await waitForState(sock1, (s) => s.roomCode === roomCode);
      const hostPlayer = state.players.find((p) => p.isHost);
      expect(hostPlayer?.nickname.length).toBeLessThanOrEqual(16);
      expect(hostPlayer?.nickname).toBe(hugeNickname.slice(0, 16));
    });

    test('Server rejects joining with malformed roomCode over socket', async () => {
      const res = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        sock1.emit('room:join', { roomCode: 12345 as unknown as string, nickname: 'Hacker' }, resolve);
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Invalid join parameters');
    });

    test('CORS blocks socket connection from unauthorized third-party origin', async () => {
      const evilSock = Client(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: {
          Origin: 'https://evil-phishing-site.com',
        },
      });
      const connectFailed = await new Promise<boolean>((resolve) => {
        evilSock.on('connect', () => {
          evilSock.disconnect();
          resolve(false);
        });
        evilSock.on('connect_error', () => {
          evilSock.disconnect();
          resolve(true);
        });
      });
      expect(connectFailed).toBe(true);
    });

    test('IP-based admin brute-force lockout persists across new socket connections', async () => {
      const url = `http://127.0.0.1:${port}`;
      const attackerHeaders = { 'cf-connecting-ip': '198.51.100.99' };
      const sA = Client(url, { transports: ['websocket'], extraHeaders: attackerHeaders });
      await new Promise<void>((r) => sA.on('connect', r));

      for (let i = 0; i < 5; i++) {
        await new Promise<{ ok: boolean }>((r) => sA.emit('admin:auth', { secret: `guess-${i}` }, r));
      }
      sA.disconnect();

      const sB = Client(url, { transports: ['websocket'], extraHeaders: attackerHeaders });
      await new Promise<void>((r) => sB.on('connect', r));

      const lockoutRes = await new Promise<{ ok: boolean; error?: string }>((r) => {
        sB.emit('admin:auth', { secret: 'any-guess' }, r);
      });
      expect(lockoutRes.ok).toBe(false);
      expect(lockoutRes.error).toContain('Too many failed attempts');
      sB.disconnect();
    });

    test('Room creation rate-limiting rejects excessive creations from same IP', async () => {
      const url = `http://127.0.0.1:${port}`;
      const flooderHeaders = { 'cf-connecting-ip': '203.0.113.42' };
      const flooder = Client(url, { transports: ['websocket'], extraHeaders: flooderHeaders });
      await new Promise<void>((r) => flooder.on('connect', r));

      let lastRes: { ok: boolean; error?: string } = { ok: true };
      for (let i = 0; i < 11; i++) {
        lastRes = await new Promise<{ ok: boolean; error?: string }>((r) => {
          flooder.emit('room:create', { nickname: `Spam${i}` }, r);
        });
      }
      expect(lastRes.ok).toBe(false);
      expect(lastRes.error).toContain('Rate limit exceeded');
      flooder.disconnect();
    });
  });

  // =========================================================================
  // 2. Broken Access Control & Anti-Cheating (OWASP A01:2021)
  // =========================================================================
  describe('A01:2021 - Broken Access Control & Cross-Player Isolation', () => {
    test('Non-host socket cannot trigger game:start or game:restart', async () => {
      const url = `http://127.0.0.1:${port}`;
      sock2 = Client(url, { transports: ['websocket'] });
      await new Promise<void>((res) => sock2.on('connect', res));

      // Client 1 creates room
      const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((resolve) => {
        sock1.emit('room:create', { nickname: 'HostAlice' }, resolve);
      });
      const roomCode = createRes.roomCode!;

      // Client 2 joins room
      await new Promise<void>((resolve) => {
        sock2.emit('room:join', { roomCode, nickname: 'GuestBob' }, () => resolve());
      });

      // Client 2 (non-host) attempts game:start
      const startRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        sock2.emit('game:start', resolve);
      });
      expect(startRes.ok).toBe(false);
      expect(startRes.error).toContain('host');

      // Client 2 (non-host) attempts game:restart
      const restartRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        sock2.emit('game:restart', resolve);
      });
      expect(restartRes.ok).toBe(false);
      expect(restartRes.error).toBeDefined();
    });

    test('Player cannot submit answers for prompts not assigned to them', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      const p2 = createMockPlayer('p2', 'Bob');
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room.players['p2'] = p2;
      room = GameEngine.startWritingPhase(room);

      const unassignedPromptId = 'prompt-unassigned-hack';
      const res = GameEngine.recordAnswer(room, 'p1', unassignedPromptId, 'Exploitative Quip');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('not assigned to you');
    });

    test('Author cannot vote in their own matchup', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      const p2 = createMockPlayer('p2', 'Bob');
      const p3 = createMockPlayer('p3', 'Charlie');

      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room.players['p2'] = p2;
      room.players['p3'] = p3;
      room = GameEngine.startWritingPhase(room);

      Object.entries(room.assignments).forEach(([pId, promptIds]) => {
        promptIds.forEach((pid) => GameEngine.recordAnswer(room, pId, pid, `Quip ${pId}`));
      });

      room.duels = GameEngine.buildDuels(room);
      room.activeDuelIndex = 0;
      room.phase = 'DUEL_VOTING';

      const activeDuel = room.duels[0];
      const authorA = activeDuel.optionA.authorId;
      const authorB = activeDuel.optionB.authorId;

      const resA = GameEngine.castVote(room, authorA, activeDuel.id, 'A');
      expect(resA.ok).toBe(false);
      expect(resA.error).toContain('Authors cannot vote');

      const resB = GameEngine.castVote(room, authorB, activeDuel.id, 'B');
      expect(resB.ok).toBe(false);
      expect(resB.error).toContain('Authors cannot vote');
    });

    test('Client state projection strictly scrubs competitor answers and author names', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      const p2 = createMockPlayer('p2', 'Bob');
      const p3 = createMockPlayer('p3', 'Charlie');

      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room.players['p2'] = p2;
      room.players['p3'] = p3;
      room = GameEngine.startWritingPhase(room);

      // In WRITING: p1 must NOT see other players' answers or unassigned prompts
      const p1Writing = GameEngine.getClientState(room, 'p1');
      expect(p1Writing.activePrompts?.length).toBe(2);
      expect((p1Writing as unknown as Record<string, unknown>).answers).toBeUndefined();

      // In DUEL_VOTING: Author nicknames must be completely redacted
      Object.entries(room.assignments).forEach(([pId, promptIds]) => {
        promptIds.forEach((pid) => GameEngine.recordAnswer(room, pId, pid, `Quip ${pId}`));
      });
      room.duels = GameEngine.buildDuels(room);
      room.phase = 'DUEL_VOTING';

      const p1Voting = GameEngine.getClientState(room, 'p1');
      expect(p1Voting.currentDuel?.optionA.authorNickname).toBeUndefined();
      expect(p1Voting.currentDuel?.optionB.authorNickname).toBeUndefined();
      expect(p1Voting.currentDuel?.results).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Prototype Pollution & Memory Safety
  // =========================================================================
  describe('Prototype Pollution & Memory Safety', () => {
    test('Blocks __proto__, constructor, and prototype injection attempts', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);
      const promptId = room.prompts[0].id;

      // Attempt prototype pollution via playerId
      const res1 = GameEngine.recordAnswer(room, '__proto__', promptId, 'Polluted');
      expect(res1.ok).toBe(false);
      expect(res1.error).toContain('Illegal player identifier');
      expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();

      // Attempt prototype pollution via voterId
      room.duels = [{
        id: 'duel-1',
        promptId,
        promptText: 'Test',
        round: 1,
        optionA: { optionKey: 'A', authorId: 'p1', text: 'A' },
        optionB: { optionKey: 'B', authorId: 'p2', text: 'B' },
        eligibleVoterIds: ['p3'],
        votes: {},
        isJinx: false,
        isForfeit: false,
        isComplete: false,
      }];
      room.activeDuelIndex = 0;

      const res2 = GameEngine.castVote(room, '__proto__', 'duel-1', 'A');
      expect(res2.ok).toBe(false);
      expect(res2.error).toContain('Illegal voter identifier');
      expect((Object.prototype as unknown as Record<string, unknown>)['duel-1']).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Input Boundary Clamping & DoS Mitigation
  // =========================================================================
  describe('Input Boundary Clamping & DoS Mitigation', () => {
    test('Clamps oversized strings to 45 characters to prevent buffer overflow/DoS', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);
      const promptId = room.prompts[0].id;

      const hugeString = 'A'.repeat(50000);
      const res = GameEngine.recordAnswer(room, 'p1', promptId, hugeString);
      expect(res.ok).toBe(true);

      const recorded = room.answers.find((a) => a.playerId === 'p1');
      expect(recorded?.text.length).toBe(45);
    });

    test('Rejects empty or whitespace-only answers', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);
      const promptId = room.prompts[0].id;

      const res1 = GameEngine.recordAnswer(room, 'p1', promptId, '');
      expect(res1.ok).toBe(false);

      const res2 = GameEngine.recordAnswer(room, 'p1', promptId, '     ');
      expect(res2.ok).toBe(false);
    });
  });
});
