import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server as HttpServer } from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { setupSocketServer } from '../socketServer';
import type {
  ClientGameState,
  ClientToServerEvents,
  ServerToClientEvents,
  AdminRoomSummary,
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

  test('Restart Guard: Host cannot restart game until all 3 rounds are completed', async () => {
    const url = `http://127.0.0.1:${port}`;
    const host = Client(url, { transports: ['websocket'] });
    await new Promise<void>((res) => host.on('connect', res));

    const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((res) => {
      host.emit('room:create', { nickname: 'Host' }, res);
    });
    expect(createRes.ok).toBe(true);

    // Attempt restart while in LOBBY (not game over)
    const restartRes = await new Promise<{ ok: boolean; error?: string }>((res) => {
      host.emit('game:restart', res);
    });
    expect(restartRes.ok).toBe(false);
    expect(restartRes.error).toContain('Cannot restart');

    host.disconnect();
  });

  test('Silent Admin Interface: Auth, Telemetry, Phase Advance, & Room Termination', async () => {
    const url = `http://127.0.0.1:${port}`;
    const adminSocket = Client(url, { transports: ['websocket'] });
    const playerSocket = Client(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((res) => adminSocket.on('connect', res)),
      new Promise<void>((res) => playerSocket.on('connect', res)),
    ]);

    // 1. Create a game room
    const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((res) => {
      playerSocket.emit('room:create', { nickname: 'Player1' }, res);
    });
    const roomCode = createRes.roomCode!;

    // 2. Reject bad admin authentication & ensure legacy backdoor is eliminated
    const badAuth = await new Promise<{ ok: boolean; error?: string }>((res) => {
      adminSocket.emit('admin:auth', { secret: 'wrong-secret' }, res);
    });
    expect(badAuth.ok).toBe(false);
    expect(badAuth.error).toBeDefined();

    const backdoorAuth = await new Promise<{ ok: boolean; error?: string }>((res) => {
      adminSocket.emit('admin:auth', { secret: 'retort-admin-2026' }, res);
    });
    expect(backdoorAuth.ok).toBe(false);
    expect(backdoorAuth.error).toContain('Invalid admin credentials');

    // 2b. Unauthenticated socket cannot execute admin commands (Security Guardrail)
    const unauthorizedList = await new Promise<AdminRoomSummary[]>((res) => {
      adminSocket.emit('admin:rooms:list', res);
    });
    expect(unauthorizedList).toEqual([]);

    const unauthorizedTerm = await new Promise<{ ok: boolean }>((res) => {
      adminSocket.emit('admin:room:terminate', { roomCode }, res);
    });
    expect(unauthorizedTerm.ok).toBe(false);

    const unauthorizedAdvance = await new Promise<{ ok: boolean }>((res) => {
      adminSocket.emit('admin:room:advance', { roomCode }, res);
    });
    expect(unauthorizedAdvance.ok).toBe(false);

    // 3. Successful admin authentication
    const goodAuth = await new Promise<{ ok: boolean }>((res) => {
      adminSocket.emit('admin:auth', { secret: process.env.ADMIN_SECRET || 'RetortAdmin' }, res);
    });
    expect(goodAuth.ok).toBe(true);

    // 4. Admin lists rooms silently
    const roomsList = await new Promise<AdminRoomSummary[]>((res) => {
      adminSocket.emit('admin:rooms:list', res);
    });
    const monitoredRoom = roomsList.find((r) => r.roomCode === roomCode);
    expect(monitoredRoom).toBeDefined();
    expect(monitoredRoom?.playerCount).toBe(1);
    expect(monitoredRoom?.activePlayers[0].nickname).toBe('Player1');

    // 5. Player socket NEVER sees admin in room players (Silent Observer Guarantee)
    const clientState = await new Promise<ClientGameState>((res) => {
      playerSocket.emit('room:join', { roomCode, nickname: 'Player1' }, () => {});
      playerSocket.on('sync:state', (s) => res(s));
    });
    // Player list must ONLY contain Player1, NEVER the admin
    expect(clientState.players.length).toBe(1);
    expect(clientState.players[0].nickname).toBe('Player1');

    // 6. Admin advances room phase
    const advanceRes = await new Promise<{ ok: boolean }>((res) => {
      adminSocket.emit('admin:room:advance', { roomCode }, res);
    });
    expect(advanceRes.ok).toBe(true);

    // 7. Admin terminates room -> Player receives room:terminated event
    const termPromise = new Promise<{ message: string }>((res) => {
      playerSocket.on('room:terminated', res);
    });

    const terminateRes = await new Promise<{ ok: boolean }>((res) => {
      adminSocket.emit('admin:room:terminate', { roomCode }, res);
    });
    expect(terminateRes.ok).toBe(true);

    const termEvent = await termPromise;
    expect(termEvent.message).toContain('closed by an administrator');

    // 8. Room is deleted from active rooms list
    const updatedRooms = await new Promise<AdminRoomSummary[]>((res) => {
      adminSocket.emit('admin:rooms:list', res);
    });
    expect(updatedRooms.some((r) => r.roomCode === roomCode)).toBe(false);

    adminSocket.disconnect();
    playerSocket.disconnect();
  });

  test('TV Host Projector receives live timer ticks on host:subscribe', async () => {
    const url = `http://127.0.0.1:${port}`;
    const hostUser = Client(url, { transports: ['websocket'] });
    const tvScreen = Client(url, { transports: ['websocket'] });
    const p2 = Client(url, { transports: ['websocket'] });
    const p3 = Client(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((r) => hostUser.on('connect', r)),
      new Promise<void>((r) => tvScreen.on('connect', r)),
      new Promise<void>((r) => p2.on('connect', r)),
      new Promise<void>((r) => p3.on('connect', r)),
    ]);

    const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((r) => {
      hostUser.emit('room:create', { nickname: 'Host' }, r);
    });
    const roomCode = createRes.roomCode!;

    await Promise.all([
      new Promise<void>((r) => p2.emit('room:join', { roomCode, nickname: 'Bob' }, () => r())),
      new Promise<void>((r) => p3.emit('room:join', { roomCode, nickname: 'Charlie' }, () => r())),
    ]);

    // TV subscribes to host display feed
    tvScreen.emit('host:subscribe', { roomCode });

    const tickPromise = new Promise<{ remaining: number }>((resolve) => {
      tvScreen.on('timer:tick', (data) => resolve(data));
    });

    // Start game to trigger phase timer
    await new Promise<void>((r) => hostUser.emit('game:start', () => r()));

    const tick = await tickPromise;
    expect(tick.remaining).toBeGreaterThanOrEqual(0);

    hostUser.disconnect();
    tvScreen.disconnect();
    p2.disconnect();
    p3.disconnect();
  });

  test('Player Reconnection: Disconnected player rebinds to active game state', async () => {
    const url = `http://127.0.0.1:${port}`;
    const hostUser = Client(url, { transports: ['websocket'] });
    let player2 = Client(url, { transports: ['websocket'] });
    const player3 = Client(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((r) => hostUser.on('connect', r)),
      new Promise<void>((r) => player2.on('connect', r)),
      new Promise<void>((r) => player3.on('connect', r)),
    ]);

    const createRes = await new Promise<{ ok: boolean; roomCode?: string }>((r) => {
      hostUser.emit('room:create', { nickname: 'Host' }, r);
    });
    const roomCode = createRes.roomCode!;

    const p2Join = await new Promise<{ ok: boolean; playerId?: string; sessionToken?: string }>((r) => {
      player2.emit('room:join', { roomCode, nickname: 'Bob' }, r);
    });
    const savedSessionToken = p2Join.sessionToken;

    await new Promise<void>((r) => {
      player3.emit('room:join', { roomCode, nickname: 'Charlie' }, () => r());
    });

    // Start game into WRITING
    await new Promise<void>((r) => hostUser.emit('game:start', () => r()));

    // Simulate mobile screen sleep / disconnection of player2
    player2.disconnect();

    // 1. Rogue socket attempting to hijack Bob's seat by nickname without sessionToken is rejected
    const rogue = Client(url, { transports: ['websocket'] });
    await new Promise<void>((r) => rogue.on('connect', r));
    const rogueRes = await new Promise<{ ok: boolean; error?: string }>((r) => {
      rogue.emit('room:join', { roomCode, nickname: 'Bob' }, r);
    });
    expect(rogueRes.ok).toBe(false);
    expect(rogueRes.error).toContain('Game already in progress');
    rogue.disconnect();

    // 2. Legitimate player reconnects with private sessionToken
    player2 = Client(url, { transports: ['websocket'] });
    await new Promise<void>((r) => player2.on('connect', r));

    const reconnectRes = await new Promise<{ ok: boolean; playerId?: string }>((r) => {
      player2.emit('room:join', { roomCode, nickname: 'Bob', sessionToken: savedSessionToken }, r);
    });
    expect(reconnectRes.ok).toBe(true);

    // Verify reconnected player receives active WRITING state with assigned prompts
    const syncState = await new Promise<ClientGameState>((resolve) => {
      player2.on('sync:state', (s) => resolve(s));
    });
    expect(syncState.phase).toBe('WRITING');
    expect(syncState.activePrompts?.length).toBeGreaterThan(0);

    hostUser.disconnect();
    player2.disconnect();
    player3.disconnect();
  });
});
