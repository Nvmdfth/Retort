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

  test('Lobby lifecycle, permissions, and multi-player state synchronization', async () => {
    const url = `http://127.0.0.1:${port}`;
    client1 = Client(url, { transports: ['websocket'] });
    client2 = Client(url, { transports: ['websocket'] });

    await new Promise<void>((resolve) => {
      let connected = 0;
      const check = () => {
        connected++;
        if (connected === 2) resolve();
      };
      client1.on('connect', check);
      client2.on('connect', check);
    });

    // 1. Client 1 creates room
    let roomCode = '';
    await new Promise<void>((resolve) => {
      client1.emit('room:create', { nickname: 'HostAlice' }, (res) => {
        expect(res.ok).toBe(true);
        expect(res.roomCode).toBeDefined();
        expect(res.roomCode?.length).toBe(4);
        roomCode = res.roomCode!;
        resolve();
      });
    });

    // 2. Client 2 joins room
    await new Promise<void>((resolve) => {
      client2.emit('room:join', { roomCode, nickname: 'PlayerBob' }, (res) => {
        expect(res.ok).toBe(true);
        resolve();
      });
    });

    // Wait for synchronized state on Client 2
    const client2LobbyState = await new Promise<ClientGameState>((resolve) => {
      client2.on('sync:state', (state) => {
        if (state.players.length === 2) resolve(state);
      });
    });

    expect(client2LobbyState.phase).toBe('LOBBY');
    expect(client2LobbyState.roomCode).toBe(roomCode);
    expect(client2LobbyState.isHost).toBe(false);
    expect(client2LobbyState.players.length).toBe(2);

    // 3. Security: Non-host cannot start game
    await new Promise<void>((resolve) => {
      client2.emit('game:start', (res) => {
        expect(res?.ok).toBe(false);
        expect(res?.error).toContain('host');
        resolve();
      });
    });

    // 4. Host starts game
    await new Promise<void>((resolve) => {
      client1.emit('game:start', (res) => {
        expect(res?.ok).toBe(true);
        resolve();
      });
    });

    // Both receive WRITING phase
    const p1WritingState = await new Promise<ClientGameState>((resolve) => {
      client1.on('sync:state', (state) => {
        if (state.phase === 'WRITING') resolve(state);
      });
    });

    expect(p1WritingState.phase).toBe('WRITING');
    expect(p1WritingState.activePrompts?.length).toBe(2);

    // 5. Submit answers for both players
    const prompt1Id = p1WritingState.activePrompts![0].id;
    const prompt2Id = p1WritingState.activePrompts![1].id;

    // Client 1 submits prompt 1
    await new Promise<void>((resolve) => {
      client1.emit('answer:submit', { promptId: prompt1Id, text: 'Quip 1 from Alice' }, (res) => {
        expect(res?.ok).toBe(true);
        resolve();
      });
    });

    // Client 1 submits prompt 2
    await new Promise<void>((resolve) => {
      client1.emit('answer:submit', { promptId: prompt2Id, text: 'Quip 2 from Alice' }, (res) => {
        expect(res?.ok).toBe(true);
        resolve();
      });
    });

    // Client 2 submits prompt 1 & 2
    await new Promise<void>((resolve) => {
      client2.emit('answer:submit', { promptId: prompt1Id, text: 'Quip 1 from Bob' }, () => {
        client2.emit('answer:submit', { promptId: prompt2Id, text: 'Quip 2 from Bob' }, (res) => {
          expect(res?.ok).toBe(true);
          resolve();
        });
      });
    });

    // Server should immediately advance to DUEL_VOTING when all submitted
    const duelState = await new Promise<ClientGameState>((resolve) => {
      client1.on('sync:state', (state) => {
        if (state.phase === 'DUEL_VOTING') resolve(state);
      });
    });

    expect(duelState.phase).toBe('DUEL_VOTING');
    expect(duelState.currentDuel).toBeDefined();
    expect(duelState.currentDuel?.optionA.text).toBeDefined();
    expect(duelState.currentDuel?.optionB.text).toBeDefined();
    // Author names must be scrubbed during voting
    expect(duelState.currentDuel?.optionA.authorNickname).toBeUndefined();
    expect(duelState.currentDuel?.optionB.authorNickname).toBeUndefined();
  }, 20000);
});
