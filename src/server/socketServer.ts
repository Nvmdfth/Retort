import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { randomInt, randomBytes } from 'crypto';
import rawSafetyQuips from './safetyQuips.json';
import { registerAdminHandlers } from './adminHandlers';
import { reclaimSeat } from './roomSession';
import {
  isSecretValid,
  resolveAdminSecret,
  getClientIp,
  isOriginAllowed,
  SlidingWindowLimiter,
  AuthLockout,
} from './security';
import {
  GameEngine,
  WRITING_DURATION,
  VOTING_DURATION,
  REVEAL_DURATION,
  INTERMISSION_DURATION,
} from './gameEngine';
import type {
  RoomState,
  Player,
  ClientToServerEvents,
  ServerToClientEvents,
  AdminRoomSummary,
} from '../types/game';

type CustomSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface ActiveTimer {
  intervalId: NodeJS.Timeout;
  phase: string;
}

export class SocketServerManager {
  private io: Server<ClientToServerEvents, ServerToClientEvents>;
  private rooms: Map<string, RoomState> = new Map();
  private timers: Map<string, ActiveTimer> = new Map();
  private adminLockout = new AuthLockout(5, 60000);
  private roomCreationLimiter = new SlidingWindowLimiter(10, 600000);
  private roomLookupMissLimiter = new SlidingWindowLimiter(20, 60000);
  private emptySince: Map<string, number> = new Map();
  private adminSecret: string;
  private roomGraceMs = parseInt(process.env.ROOM_GRACE_MS || '180000', 10);

  constructor(httpServer: HttpServer) {
    this.io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      // Origin policy is enforced in allowRequest (it can compare against the Host header);
      // cors only reflects the origin for requests that already passed that check.
      allowRequest: (req, callback) => {
        const ok = isOriginAllowed(req);
        if (!ok) console.warn(`[CORS blocked] Origin not allowed: ${req.headers.origin}`);
        callback(null, ok);
      },
      cors: { origin: true, methods: ['GET', 'POST'] },
      maxHttpBufferSize: 1e5, // 100KB payload limit for DoS mitigation
    });

    this.adminSecret = resolveAdminSecret();

    // Periodic sweep for abandoned rooms and expired rate-limit buckets
    const sweepInterval = setInterval(() => this.sweep(), Math.min(60000, Math.max(1000, this.roomGraceMs)));
    sweepInterval.unref();

    this.registerSocketEvents();
  }

  private sweep() {
    const now = Date.now();
    for (const [code, r] of this.rooms.entries()) {
      const connectedCount = Object.values(r.players).filter((p) => p.isConnected).length;
      if (connectedCount === 0) {
        // Empty rooms survive a grace period so refreshed/dropped players can reconnect by token
        const since = this.emptySince.get(code);
        if (since === undefined) {
          this.emptySince.set(code, now);
        } else if (now - since >= this.roomGraceMs) {
          this.deleteRoom(code);
        }
      } else if (r.phase === 'LOBBY' && now - r.createdAt > 3600000) {
        this.deleteRoom(code);
      }
    }
    this.adminLockout.sweep(now);
    this.roomCreationLimiter.sweep(now);
    this.roomLookupMissLimiter.sweep(now);
  }

  private deleteRoom(code: string) {
    this.clearRoomTimer(code);
    this.rooms.delete(code);
    this.emptySince.delete(code);
    this.broadcastAdminSummaries();
  }

  private terminateRoom(code: string) {
    this.io.to(`room:${code}`).emit('room:terminated', {
      message: `Room ${code} has been closed by an administrator.`,
    });
    this.deleteRoom(code);
  }

  /** Notifies every room, then stops accepting connections. Call on SIGTERM. */
  public shutdown(message = 'Server is restarting. Please rejoin in a moment.') {
    for (const code of this.rooms.keys()) {
      this.io.to(`room:${code}`).to(`host:${code}`).emit('room:terminated', { message });
    }
    return this.io.close();
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude I and O to prevent confusion
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(randomInt(0, chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  private clearRoomTimer(roomCode: string) {
    const existing = this.timers.get(roomCode);
    if (existing) {
      clearInterval(existing.intervalId);
      this.timers.delete(roomCode);
    }
  }

  public getAllAdminSummaries(): AdminRoomSummary[] {
    const list: AdminRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      list.push(GameEngine.getAdminSummary(room));
    }
    return list;
  }

  public broadcastAdminSummaries() {
    this.io.to('admin:dashboard').emit('admin:sync:rooms', this.getAllAdminSummaries());
  }

  public advanceRoomPhase(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    this.clearRoomTimer(roomCode);

    if (room.phase === 'WRITING') {
      this.transitionToVoting(roomCode);
    } else if (room.phase === 'DUEL_VOTING') {
      this.transitionToReveal(roomCode);
    } else if (room.phase === 'DUEL_REVEAL') {
      if (room.activeDuelIndex + 1 < room.duels.length) {
        room.activeDuelIndex += 1;
        room.phase = 'DUEL_VOTING';
        this.broadcastState(roomCode);
        const nextDuel = room.duels[room.activeDuelIndex];
        const isNextSpecial = nextDuel.isJinx || nextDuel.isForfeit;
        const nextDuration = isNextSpecial ? 5 : nextDuel.eligibleVoterIds.length === 0 ? 10 : VOTING_DURATION;
        this.startPhaseTimer(roomCode, nextDuration, () => {
          this.transitionToReveal(roomCode);
        });
      } else {
        if (room.round < room.totalRounds) {
          room.phase = 'ROUND_INTERMISSION';
          this.broadcastState(roomCode);
          this.startPhaseTimer(roomCode, INTERMISSION_DURATION, () => {
            const currentRoom = this.rooms.get(roomCode);
            if (!currentRoom) return;
            currentRoom.round += 1;
            const updatedRoom = GameEngine.startWritingPhase(currentRoom);
            this.rooms.set(roomCode, updatedRoom);
            this.broadcastState(roomCode);
            this.startPhaseTimer(roomCode, WRITING_DURATION, () => {
              this.transitionToVoting(roomCode);
            });
          });
        } else {
          room.phase = 'SCOREBOARD';
          room.isGameOver = true;
          this.broadcastState(roomCode);
        }
      }
    } else if (room.phase === 'ROUND_INTERMISSION') {
      room.round += 1;
      const updatedRoom = GameEngine.startWritingPhase(room);
      this.rooms.set(roomCode, updatedRoom);
      this.broadcastState(roomCode);
      this.startPhaseTimer(roomCode, WRITING_DURATION, () => {
        this.transitionToVoting(roomCode);
      });
    }
    this.broadcastAdminSummaries();
  }

  private broadcastState(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Send personalized client state to each player socket
    Object.values(room.players).forEach((player) => {
      const clientState = GameEngine.getClientState(room, player.id);
      this.io.to(player.id).emit('sync:state', clientState);
    });

    // Send host state to any host view connected to host:ROOM_CODE
    const hostState = GameEngine.getHostState(room);
    this.io.to(`host:${roomCode}`).emit('sync:host', hostState);

    // Keep admin dashboard synced silently without notifying players
    this.broadcastAdminSummaries();
  }

  private startPhaseTimer(
    roomCode: string,
    durationSeconds: number,
    onExpire: () => void
  ) {
    this.clearRoomTimer(roomCode);
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.phaseDuration = durationSeconds;
    room.phaseTimeRemaining = durationSeconds;

    const intervalId = setInterval(() => {
      const currentRoom = this.rooms.get(roomCode);
      if (!currentRoom) {
        clearInterval(intervalId);
        return;
      }

      currentRoom.phaseTimeRemaining = Math.max(0, currentRoom.phaseTimeRemaining - 1);
      this.io.to(`room:${roomCode}`).to(`host:${roomCode}`).emit('timer:tick', {
        remaining: currentRoom.phaseTimeRemaining,
      });

      if (currentRoom.phaseTimeRemaining <= 0) {
        this.clearRoomTimer(roomCode);
        onExpire();
      }
    }, 1000);

    this.timers.set(roomCode, { intervalId, phase: room.phase });
  }

  private transitionToVoting(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const duels = GameEngine.buildDuels(room);
    if (duels.length === 0) {
      room.phase = 'LOBBY';
      this.broadcastState(roomCode);
      return;
    }

    room.duels = duels;
    room.activeDuelIndex = 0;
    room.phase = 'DUEL_VOTING';

    this.broadcastState(roomCode);

    // If JINX or Forfeit, auto-transition in 3s; if 2-player testing, 5s
    const activeDuel = room.duels[0];
    const isSpecial = activeDuel.isJinx || activeDuel.isForfeit;
    const votingDuration = isSpecial ? 5 : activeDuel.eligibleVoterIds.length === 0 ? 10 : VOTING_DURATION;

    this.startPhaseTimer(roomCode, votingDuration, () => {
      this.transitionToReveal(roomCode);
    });
  }

  private transitionToReveal(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.phase = 'DUEL_REVEAL';
    GameEngine.calculateDuelResult(room);
    this.broadcastState(roomCode);

    this.startPhaseTimer(roomCode, REVEAL_DURATION, () => {
      // Check if another duel remains
      if (room.activeDuelIndex + 1 < room.duels.length) {
        room.activeDuelIndex += 1;
        room.phase = 'DUEL_VOTING';
        this.broadcastState(roomCode);

        const nextDuel = room.duels[room.activeDuelIndex];
        const isNextSpecial = nextDuel.isJinx || nextDuel.isForfeit;
        const nextDuration = isNextSpecial ? 5 : nextDuel.eligibleVoterIds.length === 0 ? 10 : VOTING_DURATION;

        this.startPhaseTimer(roomCode, nextDuration, () => {
          this.transitionToReveal(roomCode);
        });
      } else {
        // All duels in this round completed
        if (room.round < room.totalRounds) {
          // Automatic transition to round intermission
          room.phase = 'ROUND_INTERMISSION';
          this.broadcastState(roomCode);

          this.startPhaseTimer(roomCode, INTERMISSION_DURATION, () => {
            const currentRoom = this.rooms.get(roomCode);
            if (!currentRoom) return;
            currentRoom.round += 1;
            const updatedRoom = GameEngine.startWritingPhase(currentRoom);
            this.rooms.set(roomCode, updatedRoom);
            this.broadcastState(roomCode);

            this.startPhaseTimer(roomCode, WRITING_DURATION, () => {
              this.transitionToVoting(roomCode);
            });
          });
        } else {
          // All 3 rounds complete -> Finale Scoreboard (Game Over)
          room.phase = 'SCOREBOARD';
          room.isGameOver = true;
          this.clearRoomTimer(roomCode);
          this.broadcastState(roomCode);
        }
      }
    });
  }

  private registerSocketEvents() {
    this.io.on('connection', (socket: CustomSocket) => {
      let currentRoomCode: string | null = null;
      let currentPlayerId: string | null = null;

      // Host view registration
      socket.on('host:subscribe', (data, callback) => {
        try {
          const roomCode = typeof data?.roomCode === 'string' ? data.roomCode.toUpperCase().trim() : '';
          if (this.roomLookupMissLimiter.isLimited(getClientIp(socket))) {
            callback?.({ ok: false, error: 'Too many lookups. Please wait a moment.' });
            return;
          }
          const room = roomCode ? this.rooms.get(roomCode) : undefined;
          // The view key keeps the 4-letter code alone from exposing the projector feed;
          // a wrong key is reported as "not found" and throttled like a missing room.
          const key = typeof data?.key === 'string' ? data.key : '';
          if (!room || !room.hostViewKey || !isSecretValid(key, room.hostViewKey)) {
            this.roomLookupMissLimiter.hit(getClientIp(socket));
            callback?.({ ok: false, error: 'Room not found' });
            return;
          }
          socket.join(`host:${roomCode}`);
          socket.emit('sync:host', GameEngine.getHostState(room));
          callback?.({ ok: true });
        } catch (err) {
          console.error('[host:subscribe error]', err);
          callback?.({ ok: false, error: 'Server error while subscribing' });
        }
      });

      // Create new room
      socket.on('room:create', (data, callback) => {
        try {
          if (!data || typeof data.nickname !== 'string') {
            callback?.({ ok: false, error: 'Nickname must be a valid string' });
            return;
          }

          const clientIp = getClientIp(socket);
          if (this.roomCreationLimiter.isLimited(clientIp)) {
            callback?.({
              ok: false,
              error: 'Rate limit exceeded: Too many rooms created. Please wait a few minutes.',
            });
            return;
          }

          const MAX_ACTIVE_ROOMS = 200;
          if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
            callback?.({ ok: false, error: 'Server room capacity reached. Please try again later.' });
            return;
          }

          const cleanNick = data.nickname.trim().slice(0, 16) || 'Host';
          const roomCode = this.generateRoomCode();
          const sessionToken = randomBytes(16).toString('hex');
          const player: Player = {
            id: socket.id,
            sessionToken,
            nickname: cleanNick,
            avatarSeed: socket.id.slice(0, 4),
            score: 0,
            isHost: true,
            isConnected: true,
            hasSubmitted: false,
          };

          const room = GameEngine.createRoom(roomCode, player);
          this.rooms.set(roomCode, room);

          this.roomCreationLimiter.hit(clientIp);

          currentRoomCode = roomCode;
          currentPlayerId = socket.id;

          socket.join(`room:${roomCode}`);
          socket.join(socket.id);

          callback?.({ ok: true, roomCode, playerId: socket.id, sessionToken });
          this.broadcastState(roomCode);
        } catch (err) {
          console.error('[room:create error]', err);
          callback?.({ ok: false, error: 'Server error while creating room' });
        }
      });

      // Join existing room with seamless reconnection support
      socket.on('room:join', (data, callback) => {
        try {
          if (!data || typeof data.roomCode !== 'string' || typeof data.nickname !== 'string') {
            callback?.({ ok: false, error: 'Invalid join parameters' });
            return;
          }

          const code = data.roomCode.toUpperCase().trim();
          const cleanNick = data.nickname.trim().slice(0, 16) || 'Player';
          if (this.roomLookupMissLimiter.isLimited(getClientIp(socket))) {
            callback?.({ ok: false, error: 'Too many lookups. Please wait a moment.' });
            return;
          }
          const room = this.rooms.get(code);

          if (!room) {
            this.roomLookupMissLimiter.hit(getClientIp(socket));
            callback?.({ ok: false, error: 'Room not found' });
            return;
          }

          // Secure reconnect: Match private sessionToken
          const reqToken = typeof data.sessionToken === 'string' ? data.sessionToken.trim() : null;
          const reconnectingPlayer = reqToken
            ? Object.values(room.players).find((p) => p.sessionToken === reqToken)
            : null;

          if (reconnectingPlayer) {
            reclaimSeat(room, reconnectingPlayer, socket.id);

            // A returning player of an abandoned room takes the host seat back if nobody holds it
            if (!Object.values(room.players).some((p) => p.isHost && p.isConnected)) {
              Object.values(room.players).forEach((p) => { p.isHost = false; });
              reconnectingPlayer.isHost = true;
            }
            this.emptySince.delete(code);

            currentRoomCode = code;
            currentPlayerId = socket.id;

            socket.join(`room:${code}`);
            socket.join(socket.id);

            callback?.({ ok: true, playerId: socket.id, sessionToken: reconnectingPlayer.sessionToken });
            this.broadcastState(code);
            return;
          }

          if (room.phase !== 'LOBBY') {
            callback?.({ ok: false, error: 'Game already in progress' });
            return;
          }

          const sessionToken = randomBytes(16).toString('hex');
          const player: Player = {
            id: socket.id,
            sessionToken,
            nickname: cleanNick,
            avatarSeed: socket.id.slice(0, 4),
            score: 0,
            isHost: false,
            isConnected: true,
            hasSubmitted: false,
          };

          room.players[socket.id] = player;
          this.emptySince.delete(code);
          currentRoomCode = code;
          currentPlayerId = socket.id;

          socket.join(`room:${code}`);
          socket.join(socket.id);

          callback?.({ ok: true, playerId: socket.id, sessionToken });
          this.broadcastState(code);
        } catch (err) {
          console.error('[room:join error]', err);
          callback?.({ ok: false, error: 'Server error while joining room' });
        }
      });

      // Host starts game
      socket.on('game:start', (callback) => {
        try {
          if (!currentRoomCode) {
            callback?.({ ok: false, error: 'Not currently in a room' });
            return;
          }
          const room = this.rooms.get(currentRoomCode);
          if (!room) {
            callback?.({ ok: false, error: 'Room does not exist' });
            return;
          }

          if (room.phase !== 'LOBBY') {
            callback?.({ ok: false, error: 'Game has already started' });
            return;
          }

          const player = room.players[socket.id];
          if (!player?.isHost) {
            callback?.({ ok: false, error: 'Only the host can start the game' });
            return;
          }

          const activeCount = Object.values(room.players).filter((p) => p.isConnected).length;
          if (activeCount < 2) {
            callback?.({ ok: false, error: 'Need at least 2 players to start' });
            return;
          }

          room.round = 1;
          room.isGameOver = false;
          Object.values(room.players).forEach((p) => {
            p.score = 0;
            p.hasSubmitted = false;
          });
          room.answers = [];
          room.duels = [];
          room.activeDuelIndex = 0;
          room.recentScoreDeltas = [];

          const updatedRoom = GameEngine.startWritingPhase(room);
          this.rooms.set(currentRoomCode, updatedRoom);

          callback?.({ ok: true });
          this.broadcastState(currentRoomCode);

          this.startPhaseTimer(currentRoomCode, WRITING_DURATION, () => {
            this.transitionToVoting(currentRoomCode!);
          });
        } catch (err) {
          console.error('[game:start error]', err);
          callback?.({ ok: false, error: 'Server error starting game' });
        }
      });

      // Host restarts game (rematch after 3 rounds complete)
      socket.on('game:restart', (callback) => {
        try {
          if (!currentRoomCode) {
            callback?.({ ok: false, error: 'Not currently in a room' });
            return;
          }
          const room = this.rooms.get(currentRoomCode);
          if (!room) {
            callback?.({ ok: false, error: 'Room does not exist' });
            return;
          }

          if (room.phase !== 'SCOREBOARD' || !room.isGameOver) {
            callback?.({
              ok: false,
              error: 'Cannot restart until the entire 3-round game is completed',
            });
            return;
          }

          const player = room.players[socket.id];
          if (!player?.isHost) {
            callback?.({ ok: false, error: 'Only the host can restart' });
            return;
          }

          room.round = 1;
          room.isGameOver = false;
          Object.values(room.players).forEach((p) => {
            p.score = 0;
            p.hasSubmitted = false;
          });
          room.answers = [];
          room.duels = [];
          room.activeDuelIndex = 0;
          room.recentScoreDeltas = [];

          const updatedRoom = GameEngine.startWritingPhase(room);
          this.rooms.set(currentRoomCode, updatedRoom);

          callback?.({ ok: true });
          this.broadcastState(currentRoomCode);

          this.startPhaseTimer(currentRoomCode, WRITING_DURATION, () => {
            this.transitionToVoting(currentRoomCode!);
          });
        } catch (err) {
          console.error('[game:restart error]', err);
          callback?.({ ok: false, error: 'Server error restarting game' });
        }
      });

      // Submit prompt response
      socket.on('answer:submit', (data, callback) => {
        try {
          if (!currentRoomCode || !currentPlayerId) {
            callback?.({ ok: false });
            return;
          }
          const room = this.rooms.get(currentRoomCode);
          if (!room || room.phase !== 'WRITING') {
            callback?.({ ok: false });
            return;
          }

          const rawAnswer = typeof data?.text === 'string' ? data.text.trim().toLowerCase() : '';
          const isSafetyQuipMatched = (rawSafetyQuips as string[]).some(
            (sq) => sq.trim().toLowerCase() === rawAnswer
          );
          const isSafetyQuip = Boolean(data?.isSafetyQuip) || isSafetyQuipMatched;

          const { ok, allDone, room: updatedRoom } = GameEngine.recordAnswer(
            room,
            currentPlayerId,
            data?.promptId,
            data?.text,
            isSafetyQuip
          );
          this.rooms.set(currentRoomCode, updatedRoom);

          callback?.({ ok });
          this.broadcastState(currentRoomCode);

          // Instant advance if everyone has locked in their submissions
          if (allDone) {
            this.clearRoomTimer(currentRoomCode);
            this.transitionToVoting(currentRoomCode);
          }
        } catch (err) {
          console.error('[answer:submit error]', err);
          callback?.({ ok: false });
        }
      });

      // Cast vote on active duel
      socket.on('vote:cast', (data, callback) => {
        try {
          if (!currentRoomCode || !currentPlayerId) {
            callback?.({ ok: false });
            return;
          }
          const room = this.rooms.get(currentRoomCode);
          if (!room || room.phase !== 'DUEL_VOTING') {
            callback?.({ ok: false });
            return;
          }

          const { ok, allVoted, room: updatedRoom } = GameEngine.castVote(
            room,
            currentPlayerId,
            data?.duelId,
            data?.choice
          );
          this.rooms.set(currentRoomCode, updatedRoom);

          callback?.({ ok });
          this.broadcastState(currentRoomCode);

          // Instant advance if all eligible votes are cast
          if (allVoted) {
            this.clearRoomTimer(currentRoomCode);
            this.transitionToReveal(currentRoomCode);
          }
        } catch (err) {
          console.error('[vote:cast error]', err);
          callback?.({ ok: false });
        }
      });

      registerAdminHandlers(socket, {
        adminSecret: this.adminSecret,
        lockout: this.adminLockout,
        hasRoom: (code) => this.rooms.has(code),
        getSummaries: () => this.getAllAdminSummaries(),
        terminateRoom: (code) => this.terminateRoom(code),
        advanceRoom: (code) => this.advanceRoomPhase(code),
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        try {
          if (!currentRoomCode || !currentPlayerId) return;
          const room = this.rooms.get(currentRoomCode);
          if (!room) return;

          if (room.players[currentPlayerId]) {
            room.players[currentPlayerId].isConnected = false;

            // If host left, hand the seat to another connected player; with nobody else
            // connected the host keeps it so they can reclaim it on reconnect
            if (room.players[currentPlayerId].isHost) {
              const nextHost = Object.values(room.players).find((p) => p.isConnected);
              if (nextHost) {
                room.players[currentPlayerId].isHost = false;
                nextHost.isHost = true;
              }
            }
          }

          const remainingActive = Object.values(room.players).filter((p) => p.isConnected);
          if (remainingActive.length === 0) {
            // Keep the room for the reconnect grace period; sweep() deletes it afterwards
            this.emptySince.set(currentRoomCode, Date.now());
            this.broadcastAdminSummaries();
          } else {
            this.broadcastState(currentRoomCode);
          }
        } catch (err) {
          console.error('[disconnect error]', err);
        }
      });
    });
  }
}

export function setupSocketServer(httpServer: HttpServer): SocketServerManager {
  return new SocketServerManager(httpServer);
}
