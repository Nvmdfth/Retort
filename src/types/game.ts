export type GamePhase = 
  | 'LOBBY'
  | 'WRITING'
  | 'DUEL_VOTING'
  | 'DUEL_REVEAL'
  | 'SCOREBOARD';

export interface Player {
  id: string;             // Socket ID or persistent session UUID
  nickname: string;
  avatarSeed: string;
  score: number;
  isHost: boolean;
  isConnected: boolean;
  hasSubmitted: boolean;  // Live lock-in status during WRITING
}

export interface Prompt {
  id: string;
  text: string;
}

export interface AnswerSubmission {
  promptId: string;
  playerId: string;
  text: string;
  submittedAt: number;
}

export interface DuelOption {
  optionKey: 'A' | 'B';
  authorId: string;
  text: string;
  authorNickname?: string; // Revealed during DUEL_REVEAL
}

export interface Duel {
  id: string;
  promptId: string;
  promptText: string;
  optionA: DuelOption;
  optionB: DuelOption;
  eligibleVoterIds: string[]; // All active players minus authorA and authorB
  votes: Record<string, 'A' | 'B'>; // voterId -> choice
  isComplete: boolean;
}

export interface DuelResult {
  votesA: Array<{ id: string; nickname: string }>;
  votesB: Array<{ id: string; nickname: string }>;
  pctA: number;
  pctB: number;
  pointsA: number;
  pointsB: number;
  isSweepA: boolean;
  isSweepB: boolean;
}

export interface ScoreDelta {
  playerId: string;
  pointsAdded: number;
  reason: string;
}

/** Authoritative internal server room state */
export interface RoomState {
  roomCode: string;
  phase: GamePhase;
  phaseTimeRemaining: number;
  phaseDuration: number;
  round: number;
  players: Record<string, Player>;
  prompts: Prompt[];
  assignments: Record<string, string[]>; // playerId -> promptIds (2 per player)
  answers: AnswerSubmission[];
  duels: Duel[];
  activeDuelIndex: number;
  activeDuelResult?: DuelResult;
  recentScoreDeltas: ScoreDelta[];
}

/** Scrubbed payload streamed to mobile player clients */
export interface ClientGameState {
  roomCode: string;
  phase: GamePhase;
  phaseTimeRemaining: number;
  phaseDuration: number;
  round: number;
  selfPlayerId: string;
  isHost: boolean;
  players: Player[];
  activePrompts?: Prompt[];          // Only prompts assigned to this specific player
  submittedPlayerIds?: string[];     // Live checkmark roster
  currentDuel?: {
    id: string;
    promptText: string;
    duelNumber: number;
    totalDuels: number;
    optionA: { text: string; authorNickname?: string };
    optionB: { text: string; authorNickname?: string };
    canVote: boolean;                // False if player is one of the authors
    myVote?: 'A' | 'B';
    totalVotesCast: number;
    totalEligibleVoters: number;
    results?: DuelResult;
  };
  leaderboard?: Array<{
    playerId: string;
    nickname: string;
    score: number;
    rank: number;
  }>;
}

/** Big-screen host view payload (can see all submissions once active) */
export interface HostGameState {
  roomCode: string;
  phase: GamePhase;
  phaseTimeRemaining: number;
  round: number;
  players: Player[];
  submittedCount: number;
  totalPlayers: number;
  currentDuel?: {
    id: string;
    promptText: string;
    duelNumber: number;
    totalDuels: number;
    optionA: { text: string; authorNickname?: string };
    optionB: { text: string; authorNickname?: string };
    totalVotesCast: number;
    totalEligibleVoters: number;
    results?: DuelResult;
  };
  leaderboard?: Array<{
    playerId: string;
    nickname: string;
    score: number;
    rank: number;
  }>;
}

export interface ClientToServerEvents {
  'room:create': (data: { nickname: string }, callback: (res: { ok: boolean; roomCode?: string; error?: string }) => void) => void;
  'room:join': (data: { roomCode: string; nickname: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  'game:start': (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  'game:restart': (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  'answer:submit': (data: { promptId: string; text: string }, callback?: (res: { ok: boolean }) => void) => void;
  'vote:cast': (data: { duelId: string; choice: 'A' | 'B' }, callback?: (res: { ok: boolean }) => void) => void;
}

export interface ServerToClientEvents {
  'sync:state': (state: ClientGameState) => void;
  'sync:host': (state: HostGameState) => void;
  'timer:tick': (data: { remaining: number }) => void;
  'error:toast': (data: { message: string }) => void;
}
