import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import rawSafetyQuips from '@/server/safetyQuips.json';
import type {
  ClientGameState,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameStore {
  socket: TypedSocket | null;
  gameState: ClientGameState | null;
  selectedVote: 'A' | 'B' | null;
  isSubmitting: boolean;
  activePromptIndex: number;
  drafts: Record<string, string>;
  safetyQuipUsed: Record<string, boolean>;
  errorMessage: string | null;
  isConnected: boolean;

  initSocket: () => void;
  createRoom: (nickname: string) => Promise<string>;
  joinRoom: (roomCode: string, nickname: string) => Promise<void>;
  startGame: () => void;
  restartGame: () => void;
  setActivePromptIndex: (index: number) => void;
  setDraft: (promptId: string, text: string) => void;
  fillSafetyQuip: (promptId: string) => void;
  submitAnswer: (promptId: string, text: string, isSafetyQuip?: boolean) => void;
  castVote: (duelId: string, choice: 'A' | 'B') => void;
  clearError: () => void;
}

let errorTimeout: NodeJS.Timeout | null = null;

const SESSION_KEYS = ['retort_room_code', 'retort_nickname', 'retort_player_id', 'retort_session_token'];

function clearSession() {
  if (typeof window === 'undefined') return;
  SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
}

const SAFETY_QUIP_POOL = rawSafetyQuips as string[];

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  selectedVote: null,
  isSubmitting: false,
  activePromptIndex: 0,
  drafts: {},
  safetyQuipUsed: {},
  errorMessage: null,
  isConnected: false,

  initSocket: () => {
    if (get().socket) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const socket: TypedSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    // socket.io reconnects with a new socket id and no room membership, so re-claim the seat
    // with the stored session token whenever a socket reconnects mid-game.
    socket.on('connect', () => {
      set({ isConnected: true });
      if (typeof window === 'undefined' || !get().gameState) return;
      const roomCode = sessionStorage.getItem('retort_room_code');
      const nickname = sessionStorage.getItem('retort_nickname');
      const sessionToken = sessionStorage.getItem('retort_session_token');
      if (!roomCode || !nickname || !sessionToken) return;
      socket.emit('room:join', { roomCode, nickname, sessionToken }, (res) => {
        if (res.ok) {
          if (res.playerId) sessionStorage.setItem('retort_player_id', res.playerId);
        } else {
          clearSession();
          set({ gameState: null, errorMessage: res.error || 'Could not rejoin the room' });
        }
      });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('sync:state', (newState) => {
      const prevPhase = get().gameState?.phase;
      const prevDuelId = get().gameState?.currentDuel?.id;
      const nextDuelId = newState.currentDuel?.id;

      // Reset prompt index on new round / writing start
      if (prevPhase !== 'WRITING' && newState.phase === 'WRITING') {
        set({ activePromptIndex: 0, drafts: {}, safetyQuipUsed: {} });
      }

      // Reset optimistic vote if duel changes
      if (prevDuelId !== nextDuelId) {
        set({ selectedVote: null });
      }

      set({ gameState: newState, isSubmitting: false });
    });

    socket.on('timer:tick', ({ remaining }) => {
      set((state) =>
        state.gameState
          ? { gameState: { ...state.gameState, phaseTimeRemaining: remaining } }
          : {}
      );
    });

    socket.on('error:toast', ({ message }) => {
      if (errorTimeout) clearTimeout(errorTimeout);
      set({ errorMessage: message });
      errorTimeout = setTimeout(() => {
        set({ errorMessage: null });
      }, 4000);
    });

    socket.on('room:terminated', ({ message }) => {
      clearSession();
      set({ errorMessage: message, gameState: null });
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          window.location.replace('/');
        }, 1500);
      }
    });

    set({ socket });
  },

  createRoom: (nickname: string) => {
    return new Promise<string>((resolve, reject) => {
      const socket = get().socket;
      if (!socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      socket.emit('room:create', { nickname }, (res) => {
        if (res.ok && res.roomCode) {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('retort_room_code', res.roomCode);
            sessionStorage.setItem('retort_nickname', nickname);
            if (res.playerId) sessionStorage.setItem('retort_player_id', res.playerId);
            if (res.sessionToken) sessionStorage.setItem('retort_session_token', res.sessionToken);
          }
          resolve(res.roomCode);
        } else {
          set({ errorMessage: res.error || 'Failed to create room' });
          reject(new Error(res.error || 'Failed to create room'));
        }
      });
    });
  },

  joinRoom: (roomCode: string, nickname: string) => {
    return new Promise<void>((resolve, reject) => {
      const socket = get().socket;
      if (!socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      const storedPlayerId = typeof window !== 'undefined' ? sessionStorage.getItem('retort_player_id') || undefined : undefined;
      const storedSessionToken = typeof window !== 'undefined' ? sessionStorage.getItem('retort_session_token') || undefined : undefined;

      socket.emit('room:join', { roomCode, nickname, playerId: storedPlayerId, sessionToken: storedSessionToken }, (res) => {
        if (res.ok) {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('retort_room_code', roomCode);
            sessionStorage.setItem('retort_nickname', nickname);
            if (res.playerId) sessionStorage.setItem('retort_player_id', res.playerId);
            if (res.sessionToken) sessionStorage.setItem('retort_session_token', res.sessionToken);
          }
          resolve();
        } else {
          set({ errorMessage: res.error || 'Failed to join room' });
          reject(new Error(res.error || 'Failed to join room'));
        }
      });
    });
  },

  startGame: () => {
    get().socket?.emit('game:start', (res) => {
      if (res && !res.ok && res.error) {
        set({ errorMessage: res.error });
      }
    });
  },

  restartGame: () => {
    get().socket?.emit('game:restart', (res) => {
      if (res && !res.ok && res.error) {
        set({ errorMessage: res.error });
      }
    });
  },

  setActivePromptIndex: (index: number) => {
    set({ activePromptIndex: index });
  },

  setDraft: (promptId: string, text: string) => {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [promptId]: text.slice(0, 45),
      },
    }));
  },

  fillSafetyQuip: (promptId: string) => {
    const quip = SAFETY_QUIP_POOL[Math.floor(Math.random() * SAFETY_QUIP_POOL.length)];
    set((state) => ({
      drafts: { ...state.drafts, [promptId]: quip },
      safetyQuipUsed: { ...state.safetyQuipUsed, [promptId]: true },
    }));
  },

  submitAnswer: (promptId: string, text: string, isSafetyQuip?: boolean) => {
    const clean = text.trim().slice(0, 45);
    if (!clean) return;

    if (!get().isConnected) {
      set({ errorMessage: 'Reconnecting… try again in a moment' });
      return;
    }

    const usedSafety = isSafetyQuip ?? Boolean(get().safetyQuipUsed[promptId]);

    set({ isSubmitting: true });
    get().socket?.emit('answer:submit', { promptId, text: clean, isSafetyQuip: usedSafety }, (res) => {
      set({ isSubmitting: false });
      if (res && !res.ok) {
        set({ errorMessage: 'Submission rejected by server' });
      }
    });
  },

  castVote: (duelId: string, choice: 'A' | 'B') => {
    if (!get().isConnected) {
      set({ errorMessage: 'Reconnecting… try again in a moment' });
      return;
    }

    const previousVote = get().selectedVote;
    set({ selectedVote: choice });

    get().socket?.emit('vote:cast', { duelId, choice }, (res) => {
      if (res && !res.ok) {
        // Roll back optimistic vote
        set({ selectedVote: previousVote, errorMessage: 'Vote could not be recorded' });
      }
    });
  },

  clearError: () => set({ errorMessage: null }),
}));
