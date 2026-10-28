import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
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
  errorMessage: string | null;

  initSocket: () => void;
  createRoom: (nickname: string) => Promise<string>;
  joinRoom: (roomCode: string, nickname: string) => Promise<void>;
  startGame: () => void;
  restartGame: () => void;
  setActivePromptIndex: (index: number) => void;
  setDraft: (promptId: string, text: string) => void;
  submitAnswer: (promptId: string, text: string) => void;
  castVote: (duelId: string, choice: 'A' | 'B') => void;
  clearError: () => void;
}

let errorTimeout: NodeJS.Timeout | null = null;

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  selectedVote: null,
  isSubmitting: false,
  activePromptIndex: 0,
  drafts: {},
  errorMessage: null,

  initSocket: () => {
    if (get().socket) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const socket: TypedSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('sync:state', (newState) => {
      const prevPhase = get().gameState?.phase;
      const prevDuelId = get().gameState?.currentDuel?.id;
      const nextDuelId = newState.currentDuel?.id;

      // Reset prompt index on new round / writing start
      if (prevPhase !== 'WRITING' && newState.phase === 'WRITING') {
        set({ activePromptIndex: 0, drafts: {} });
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

      socket.emit('room:join', { roomCode, nickname }, (res) => {
        if (res.ok) {
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

  submitAnswer: (promptId: string, text: string) => {
    const clean = text.trim().slice(0, 45);
    if (!clean) return;

    set({ isSubmitting: true });
    get().socket?.emit('answer:submit', { promptId, text: clean }, (res) => {
      set({ isSubmitting: false });
      if (res && !res.ok) {
        set({ errorMessage: 'Submission rejected by server' });
      }
    });
  },

  castVote: (duelId: string, choice: 'A' | 'B') => {
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
