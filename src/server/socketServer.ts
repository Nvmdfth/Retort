import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import {
  GameEngine,
  WRITING_DURATION,
  VOTING_DURATION,
  REVEAL_DURATION,
} from './gameEngine';
import type {
  RoomState,
  Player,
  ClientToServerEvents,
  ServerToClientEvents,
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

  constructor(httpServer: HttpServer) {
    this.io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.registerSocketEvents();
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude I and O to prevent confusion
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
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
      this.io.to(`room:${roomCode}`).emit('timer:tick', {
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
    const votingDuration = isSpecial ? 3 : activeDuel.eligibleVoterIds.length === 0 ? 5 : VOTING_DURATION;

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
        const nextDuration = isNextSpecial ? 3 : nextDuel.eligibleVoterIds.length === 0 ? 5 : VOTING_DURATION;

        this.startPhaseTimer(roomCode, nextDuration, () => {
          this.transitionToReveal(roomCode);
        });
      } else {
        // All duels completed -> Scoreboard
        room.phase = 'SCOREBOARD';
        this.clearRoomTimer(roomCode);
        this.broadcastState(roomCode);
      }
    });
  }

  private registerSocketEvents() {
    this.io.on('connection', (socket: CustomSocket) => {
      let currentRoomCode: string | null = null;
      let currentPlayerId: string | null = null;

      // Host view registration
      socket.on('host:subscribe' as any, (data: any) => {
        try {
          const roomCode = typeof data?.roomCode === 'string' ? data.roomCode.toUpperCase().trim() : '';
          if (roomCode) {
            socket.join(`host:${roomCode}`);
            const room = this.rooms.get(roomCode);
            if (room) {
              socket.emit('sync:host', GameEngine.getHostState(room));
            }
          }
        } catch (err) {
          console.error('[host:subscribe error]', err);
        }
      });

      // Create new room
      socket.on('room:create', (data, callback) => {
        try {
          if (!data || typeof data.nickname !== 'string') {
            callback?.({ ok: false, error: 'Nickname must be a valid string' });
            return;
          }

          const cleanNick = data.nickname.trim().slice(0, 16) || 'Host';
          const roomCode = this.generateRoomCode();
          const player: Player = {
            id: socket.id,
            nickname: cleanNick,
            avatarSeed: socket.id.slice(0, 4),
            score: 0,
            isHost: true,
            isConnected: true,
            hasSubmitted: false,
          };

          const room = GameEngine.createRoom(roomCode, player);
          this.rooms.set(roomCode, room);

          currentRoomCode = roomCode;
          currentPlayerId = socket.id;

          socket.join(`room:${roomCode}`);
          socket.join(socket.id);

          callback?.({ ok: true, roomCode });
          this.broadcastState(roomCode);
        } catch (err) {
          console.error('[room:create error]', err);
          callback?.({ ok: false, error: 'Server error while creating room' });
        }
      });

      // Join existing room
      socket.on('room:join', (data, callback) => {
        try {
          if (!data || typeof data.roomCode !== 'string' || typeof data.nickname !== 'string') {
            callback?.({ ok: false, error: 'Invalid join parameters' });
            return;
          }

          const code = data.roomCode.toUpperCase().trim();
          const cleanNick = data.nickname.trim().slice(0, 16) || 'Player';
          const room = this.rooms.get(code);

          if (!room) {
            callback?.({ ok: false, error: 'Room not found' });
            return;
          }

          if (room.phase !== 'LOBBY') {
            callback?.({ ok: false, error: 'Game already in progress' });
            return;
          }

          const player: Player = {
            id: socket.id,
            nickname: cleanNick,
            avatarSeed: socket.id.slice(0, 4),
            score: 0,
            isHost: false,
            isConnected: true,
            hasSubmitted: false,
          };

          room.players[socket.id] = player;
          currentRoomCode = code;
          currentPlayerId = socket.id;

          socket.join(`room:${code}`);
          socket.join(socket.id);

          callback?.({ ok: true });
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

      // Host restarts game / new round
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

          if (room.phase !== 'SCOREBOARD') {
            callback?.({ ok: false, error: 'Can only restart from the scoreboard' });
            return;
          }

          const player = room.players[socket.id];
          if (!player?.isHost) {
            callback?.({ ok: false, error: 'Only the host can restart' });
            return;
          }

          room.round += 1;
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

          const { ok, allDone, room: updatedRoom } = GameEngine.recordAnswer(
            room,
            currentPlayerId,
            data?.promptId,
            data?.text,
            Boolean(data?.isSafetyQuip)
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

      // Disconnect handling
      socket.on('disconnect', () => {
        try {
          if (!currentRoomCode || !currentPlayerId) return;
          const room = this.rooms.get(currentRoomCode);
          if (!room) return;

          if (room.players[currentPlayerId]) {
            room.players[currentPlayerId].isConnected = false;

            // If host left, elect next available player as host
            if (room.players[currentPlayerId].isHost) {
              room.players[currentPlayerId].isHost = false;
              const nextHost = Object.values(room.players).find((p) => p.isConnected);
              if (nextHost) {
                nextHost.isHost = true;
              }
            }
          }

          const remainingActive = Object.values(room.players).filter((p) => p.isConnected);
          if (remainingActive.length === 0) {
            this.clearRoomTimer(currentRoomCode);
            this.rooms.delete(currentRoomCode);
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
