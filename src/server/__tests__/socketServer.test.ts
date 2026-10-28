import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server as HttpServer } from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { setupSocketServer } from '../socketServer';
import type {
  ClientGameState,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../types/game';

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function waitForState(
  socket: TypedClientSocket,
  predicate: (state: ClientGameState) => boolean,
  timeoutMs = 10000
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

describe('Retort Socket Server Real-Time Integration', () => {
  let httpServer: HttpServer;
  let port: number;
  let client1: TypedClientSocket;
  let client2: TypedClientSocket;
  let client3: TypedClientSocket;

  beforeAll(async () => {
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

  afterAll(async () => {
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    if (client3?.connected) client3.disconnect();
    httpServer.close();
  });

  test('3-Player Game Loop: Lobby, Writing, Duel Voting, Author Lockout, Reveal, & Permissions', async () => {
    const url = `http://127.0.0.1:${port}`;
    client1 = Client(url, { transports: ['websocket'] });
    client2 = Client(url, { transports: ['websocket'] });
    client3 = Client(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((res) => client1.on('connect', res)),
      new Promise<void>((res) => client2.on('connect', res)),
      new Promise<void>((res) => client3.on('connect', res)),
    ]);

    // Negative path 1: Join non-existent room
    const badJoinRes = await new Promise<{ ok: boolean; error?: string }>((res) => {
      client2.emit('room:join', { roomCode: 'ZZZZ', nickname: 'Bob' }, res);
    });
    expect(badJoinRes.ok).toBe(false);
    expect(badJoinRes.error).toContain('not found');

    // 1. Client 1 creates room
    const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((res) => {
      client1.emit('room:create', { nickname: 'Alice' }, res);
    });
    expect(createRes.ok).toBe(true);
    const roomCode = createRes.roomCode!;
    expect(roomCode.length).toBe(4);

    // 2. Client 2 and 3 join
    const p2LobbyPromise = waitForState(client2, (s) => s.players.length === 2);
    await new Promise((res) => client2.emit('room:join', { roomCode, nickname: 'Bob' }, res));
    await p2LobbyPromise;

    const p3LobbyPromise = waitForState(client3, (s) => s.players.length === 3);
    await new Promise((res) => client3.emit('room:join', { roomCode, nickname: 'Charlie' }, res));
    const lobbyState3 = await p3LobbyPromise;
    expect(lobbyState3.players.length).toBe(3);

    // Permission check: Non-host cannot start game
    const nonHostStartRes = await new Promise<{ ok: boolean; error?: string }>((res) => {
      client2.emit('game:start', res);
    });
    expect(nonHostStartRes.ok).toBe(false);

    // Permission check: Non-host cannot restart game
    const nonHostRestartRes = await new Promise<{ ok: boolean; error?: string }>((res) => {
      client2.emit('game:restart', res);
    });
    expect(nonHostRestartRes.ok).toBe(false);

    // 3. Host starts game
    const p1WritingPromise = waitForState(client1, (s) => s.phase === 'WRITING');
    const p2WritingPromise = waitForState(client2, (s) => s.phase === 'WRITING');
    const p3WritingPromise = waitForState(client3, (s) => s.phase === 'WRITING');

    await new Promise((res) => client1.emit('game:start', res));
    const [w1, w2, w3] = await Promise.all([p1WritingPromise, p2WritingPromise, p3WritingPromise]);

    expect(w1.activePrompts?.length).toBe(2);
    expect(w2.activePrompts?.length).toBe(2);
    expect(w3.activePrompts?.length).toBe(2);

    // 4. Submit answers for all players across their 2 assigned prompts
    for (const prompt of w1.activePrompts!) {
      await new Promise((res) => client1.emit('answer:submit', { promptId: prompt.id, text: `Ans Alice ${prompt.id}` }, res));
    }
    for (const prompt of w2.activePrompts!) {
      await new Promise((res) => client2.emit('answer:submit', { promptId: prompt.id, text: `Ans Bob ${prompt.id}` }, res));
    }

    // Set up duel listeners before last submission triggers phase transition
    const p1DuelPromise = waitForState(client1, (s) => s.phase === 'DUEL_VOTING');
    const p2DuelPromise = waitForState(client2, (s) => s.phase === 'DUEL_VOTING');
    const p3DuelPromise = waitForState(client3, (s) => s.phase === 'DUEL_VOTING');

    for (const prompt of w3.activePrompts!) {
      await new Promise((res) => client3.emit('answer:submit', { promptId: prompt.id, text: `Ans Charlie ${prompt.id}` }, res));
    }

    const [duel1, duel2, duel3] = await Promise.all([p1DuelPromise, p2DuelPromise, p3DuelPromise]);
    expect(duel1.phase).toBe('DUEL_VOTING');
    expect(duel2.phase).toBe('DUEL_VOTING');
    expect(duel3.phase).toBe('DUEL_VOTING');

    const activeDuel = duel1.currentDuel!;
    expect(activeDuel).toBeDefined();
    // Author names MUST be scrubbed during voting
    expect(activeDuel.optionA.authorNickname).toBeUndefined();
    expect(activeDuel.optionB.authorNickname).toBeUndefined();

    // 5. Voting & Author Lockout Verification:
    // Determine which clients are authors vs voter in this 3-player duel
    const clients = [client1, client2, client3];
    const duelStates = [duel1, duel2, duel3];

    const authorClientIndex = duelStates.findIndex((s) => s.currentDuel?.canVote === false);
    const voterClientIndex = duelStates.findIndex((s) => s.currentDuel?.canVote === true);

    expect(authorClientIndex).toBeGreaterThanOrEqual(0);
    expect(voterClientIndex).toBeGreaterThanOrEqual(0);

    const authorClient = clients[authorClientIndex];
    const voterClient = clients[voterClientIndex];

    // Author attempts to vote on their own duel -> Rejected server-side
    const authorVoteRes = await new Promise<{ ok: boolean }>((res) => {
      authorClient.emit('vote:cast', { duelId: activeDuel.id, choice: 'A' }, res);
    });
    expect(authorVoteRes.ok).toBe(false);

    // Eligible voter casts vote -> Succeeds
    const revealPromise1 = waitForState(client1, (s) => s.phase === 'DUEL_REVEAL');
    const revealPromise2 = waitForState(client2, (s) => s.phase === 'DUEL_REVEAL');
    const revealPromise3 = waitForState(client3, (s) => s.phase === 'DUEL_REVEAL');

    const voterRes = await new Promise<{ ok: boolean }>((res) => {
      voterClient.emit('vote:cast', { duelId: activeDuel.id, choice: 'A' }, res);
    });
    expect(voterRes.ok).toBe(true);

    // 6. Duel Reveal Phase Verification:
    // When eligible voter votes, server auto-advances to DUEL_REVEAL
    const [rev1, rev2, rev3] = await Promise.all([revealPromise1, revealPromise2, revealPromise3]);
    expect(rev1.phase).toBe('DUEL_REVEAL');
    expect(rev2.phase).toBe('DUEL_REVEAL');
    expect(rev3.phase).toBe('DUEL_REVEAL');

    // Author names are revealed on all clients!
    expect(rev1.currentDuel?.optionA.authorNickname).toBeDefined();
    expect(rev1.currentDuel?.optionB.authorNickname).toBeDefined();
    expect(rev1.currentDuel?.results).toBeDefined();
  }, 30000);
});
