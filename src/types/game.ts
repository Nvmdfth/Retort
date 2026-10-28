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
  isFinale?: boolean;     // Round 3 The Last Lash
  secretTriggers?: Record<string, string>; // answer -> roast
}

export interface AnswerSubmission {
  promptId: string;
  playerId: string;
  text: string;
  isSafetyQuip: boolean;
  submittedAt: number;
}

export interface DuelOption {
  optionKey: 'A' | 'B';
  authorId: string;
  text: string;
  authorNickname?: string; // Revealed during DUEL_REVEAL
  isSafetyQuip?: boolean;  // If true, 50% point penalty
  secretRoast?: string;    // Schmitty / Host Quip Pro Quo roast
}

export interface Duel {
  id: string;
  promptId: string;
  promptText: string;
  round: number;
  optionA: DuelOption;
  optionB: DuelOption;
  eligibleVoterIds: string[]; // All active players minus authorA and authorB
  votes: Record<string, 'A' | 'B'>; // voterId -> choice
  isJinx: boolean;            // Identical answers submitted
  isForfeit: boolean;         // One player timed out
  forfeitWinnerId?: string;
  isComplete: boolean;
}

export interface DuelResult {
  isJinx: boolean;
  isForfeit: boolean;
  votesA: Array<{ id: string; nickname: string }>;
  votesB: Array<{ id: string; nickname: string }>;
  pctA: number;
  pctB: number;
  pointsA: number;
  pointsB: number;
  winnerKey?: 'A' | 'B' | 'TIE';
  winnerBonus?: number;       // +100 (R1) or +200 (R2)
  isSweepA: boolean;          // +250 (R1) or +500 (R2)
  isSweepB: boolean;
  penaltyA?: boolean;         // 50% safety quip penalty
  penaltyB?: boolean;
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
  round: number;              // 1 = Normal, 2 = Doubled, 3 = Finale
  players: Record<string, Player>;
  prompts: Prompt[];
  assignments: Record<string, string[]>; // playerId -> promptIds
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
  roundMultiplier: number;           // 1x in R1, 2x in R2, 3x in R3
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
    isJinx: boolean;
    isForfeit: boolean;
    optionA: {
      text: string;
      authorNickname?: string;
      isSafetyQuip?: boolean;
      secretRoast?: string;
    };
    optionB: {
      text: string;
      authorNickname?: string;
      isSafetyQuip?: boolean;
      secretRoast?: string;
    };
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

/** Big-screen host view payload */
export interface HostGameState {
  roomCode: string;
  phase: GamePhase;
  phaseTimeRemaining: number;
  round: number;
  roundMultiplier: number;
  players: Player[];
  submittedCount: number;
  totalPlayers: number;
  currentDuel?: {
    id: string;
    promptText: string;
    duelNumber: number;
    totalDuels: number;
    isJinx: boolean;
    isForfeit: boolean;
    optionA: {
      text: string;
      authorNickname?: string;
      isSafetyQuip?: boolean;
      secretRoast?: string;
    };
    optionB: {
      text: string;
      authorNickname?: string;
      isSafetyQuip?: boolean;
      secretRoast?: string;
    };
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
  'answer:submit': (data: { promptId: string; text: string; isSafetyQuip?: boolean }, callback?: (res: { ok: boolean }) => void) => void;
  'vote:cast': (data: { duelId: string; choice: 'A' | 'B' }, callback?: (res: { ok: boolean }) => void) => void;
}

export interface ServerToClientEvents {
  'sync:state': (state: ClientGameState) => void;
  'sync:host': (state: HostGameState) => void;
  'timer:tick': (data: { remaining: number }) => void;
  'error:toast': (data: { message: string }) => void;
}
