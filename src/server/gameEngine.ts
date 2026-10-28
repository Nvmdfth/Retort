import rawPrompts from './prompts.json';
import type {
  RoomState,
  Player,
  Prompt,
  Duel,
  DuelResult,
  ClientGameState,
  HostGameState,
  ScoreDelta,
} from '../types/game';

const BASE_MATCHUP_POINTS = 1000;
const SWEEP_BONUS_POINTS = 250;

export const WRITING_DURATION = 60; // seconds
export const VOTING_DURATION = 16;  // seconds
export const REVEAL_DURATION = 7;   // seconds

// Fisher-Yates unbiased array shuffle
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameEngine {
  public static createRoom(roomCode: string, hostPlayer: Player): RoomState {
    return {
      roomCode,
      phase: 'LOBBY',
      phaseTimeRemaining: 0,
      phaseDuration: 0,
      round: 1,
      players: { [hostPlayer.id]: hostPlayer },
      prompts: [],
      assignments: {},
      answers: [],
      duels: [],
      activeDuelIndex: 0,
      recentScoreDeltas: [],
    };
  }

  /**
   * Generates mathematical circular ring topology for prompt assignments:
   * Player i faces Player (i+1)%N on Prompt i.
   * Player i writes answers for Prompt (i-1+N)%N and Prompt i.
   */
  public static startWritingPhase(room: RoomState): RoomState {
    const playerList = Object.values(room.players).filter((p) => p.isConnected);
    const n = playerList.length;

    // Pick N unique prompts randomly with Fisher-Yates
    const shuffledDeck = shuffleArray(rawPrompts);
    const needed = Math.max(n, 2);
    const selectedPrompts: Prompt[] = [];

    for (let idx = 0; idx < needed; idx++) {
      const text = shuffledDeck[idx % shuffledDeck.length];
      selectedPrompts.push({
        id: `prompt-${room.round}-${idx}-${Date.now()}`,
        text,
      });
    }

    const assignments: Record<string, string[]> = {};
    playerList.forEach((p) => {
      assignments[p.id] = [];
      p.hasSubmitted = false;
    });

    if (n === 2) {
      // 2-player mode: both players receive both prompts
      assignments[playerList[0].id] = [selectedPrompts[0].id, selectedPrompts[1].id];
      assignments[playerList[1].id] = [selectedPrompts[0].id, selectedPrompts[1].id];
    } else {
      // Circular ring topology for N >= 3
      for (let i = 0; i < n; i++) {
        const pCurrent = playerList[i];
        const pNext = playerList[(i + 1) % n];
        const prompt = selectedPrompts[i];

        assignments[pCurrent.id].push(prompt.id);
        assignments[pNext.id].push(prompt.id);
      }
    }

    return {
      ...room,
      phase: 'WRITING',
      phaseDuration: WRITING_DURATION,
      phaseTimeRemaining: WRITING_DURATION,
      prompts: selectedPrompts,
      assignments,
      answers: [],
      duels: [],
      activeDuelIndex: 0,
      activeDuelResult: undefined,
      recentScoreDeltas: [],
    };
  }

  /**
   * Record answer submission.
   * Validates string type, character limits, and assignment ownership.
   */
  public static recordAnswer(
    room: RoomState,
    playerId: string,
    promptId: string,
    rawText: unknown
  ): { ok: boolean; allDone: boolean; error?: string; room: RoomState } {
    if (typeof rawText !== 'string' || typeof promptId !== 'string') {
      return { ok: false, allDone: false, error: 'Invalid payload format', room };
    }

    const text = rawText.trim().slice(0, 45);
    if (!text) {
      return { ok: false, allDone: false, error: 'Answer cannot be empty', room };
    }

    // Verify this prompt was actually assigned to this player
    const assignedPromptIds = room.assignments[playerId] || [];
    if (!assignedPromptIds.includes(promptId)) {
      return { ok: false, allDone: false, error: 'Prompt is not assigned to you', room };
    }

    // Remove prior answer for same prompt if player edits/re-submits
    const filteredAnswers = room.answers.filter(
      (a) => !(a.playerId === playerId && a.promptId === promptId)
    );
    filteredAnswers.push({
      promptId,
      playerId,
      text,
      submittedAt: Date.now(),
    });

    room.answers = filteredAnswers;

    // Check if this player has answered all their assigned prompts
    const playerAnswers = filteredAnswers.filter((a) => a.playerId === playerId);
    const hasFinishedAll = assignedPromptIds.every((pid) =>
      playerAnswers.some((ans) => ans.promptId === pid)
    );

    if (room.players[playerId]) {
      room.players[playerId].hasSubmitted = hasFinishedAll;
    }

    const activePlayers = Object.values(room.players).filter((p) => p.isConnected);
    const allDone = activePlayers.length > 0 && activePlayers.every((p) => p.hasSubmitted);

    return { ok: true, allDone, room };
  }

  /**
   * Builds head-to-head duels from collected answers.
   * In Quiplash style, if a player submitted no answer, a fallback default punchline is used.
   */
  public static buildDuels(room: RoomState): Duel[] {
    const duels: Duel[] = [];
    const allPlayerIds = Object.keys(room.players);

    room.prompts.forEach((prompt, idx) => {
      const answersForPrompt = room.answers.filter((a) => a.promptId === prompt.id);
      
      // Identify who was assigned this prompt
      const assignedPlayers = Object.entries(room.assignments)
        .filter(([, promptIds]) => promptIds.includes(prompt.id))
        .map(([pId]) => pId);

      if (assignedPlayers.length >= 2) {
        const pAId = assignedPlayers[0];
        const pBId = assignedPlayers[1];

        const ansA = answersForPrompt.find((a) => a.playerId === pAId)?.text || '[Too slow to write an answer!]';
        const ansB = answersForPrompt.find((a) => a.playerId === pBId)?.text || '[Too slow to write an answer!]';

        const authorA = room.players[pAId];
        const authorB = room.players[pBId];

        // Eligible voters exclude the two authors
        const eligibleVoterIds = allPlayerIds.filter(
          (pid) => pid !== pAId && pid !== pBId && room.players[pid]?.isConnected
        );

        // Randomize whether Option A is Player A or B to avoid position bias
        const swap = Math.random() < 0.5;

        duels.push({
          id: `duel-${prompt.id}-${idx}`,
          promptId: prompt.id,
          promptText: prompt.text,
          optionA: {
            optionKey: 'A',
            authorId: swap ? pBId : pAId,
            text: swap ? ansB : ansA,
            authorNickname: (swap ? authorB : authorA)?.nickname || 'Player',
          },
          optionB: {
            optionKey: 'B',
            authorId: swap ? pAId : pBId,
            text: swap ? ansA : ansB,
            authorNickname: (swap ? authorA : authorB)?.nickname || 'Player',
          },
          eligibleVoterIds,
          votes: {},
          isComplete: false,
        });
      }
    });

    return shuffleArray(duels);
  }

  /**
   * Cast vote on active duel.
   * Validates choice, voter eligibility, and prevents author self-voting.
   */
  public static castVote(
    room: RoomState,
    voterId: string,
    duelId: string,
    choice: unknown
  ): { ok: boolean; allVoted: boolean; error?: string; room: RoomState } {
    if (choice !== 'A' && choice !== 'B') {
      return { ok: false, allVoted: false, error: 'Vote choice must be A or B', room };
    }

    const duel = room.duels[room.activeDuelIndex];
    if (!duel || duel.id !== duelId || duel.isComplete) {
      return { ok: false, allVoted: false, error: 'Active duel not found', room };
    }

    // Author cannot vote on their own duel
    if (voterId === duel.optionA.authorId || voterId === duel.optionB.authorId) {
      return { ok: false, allVoted: false, error: 'Authors cannot vote on their own duel', room };
    }

    // Voter must be in eligible voters list (or in 2-player game where audience/spectators vote)
    if (duel.eligibleVoterIds.length > 0 && !duel.eligibleVoterIds.includes(voterId)) {
      return { ok: false, allVoted: false, error: 'Not eligible to vote in this duel', room };
    }

    duel.votes[voterId] = choice;

    const votesCastCount = Object.keys(duel.votes).length;
    const allVoted = duel.eligibleVoterIds.length > 0 && votesCastCount >= duel.eligibleVoterIds.length;

    return { ok: true, allVoted, room };
  }

  /**
   * Tally votes for active duel and calculate Quiplash point distributions.
   */
  public static calculateDuelResult(room: RoomState): DuelResult {
    const duel = room.duels[room.activeDuelIndex];
    const votesList = Object.entries(duel.votes);
    const votesA: Array<{ id: string; nickname: string }> = [];
    const votesB: Array<{ id: string; nickname: string }> = [];

    votesList.forEach(([voterId, choice]) => {
      const p = room.players[voterId];
      const entry = { id: voterId, nickname: p?.nickname || 'Voter' };
      if (choice === 'A') votesA.push(entry);
      else votesB.push(entry);
    });

    const totalVotes = votesA.length + votesB.length;
    let pctA = 50;
    let pctB = 50;
    let pointsA = Math.round(BASE_MATCHUP_POINTS / 2);
    let pointsB = Math.round(BASE_MATCHUP_POINTS / 2);

    if (totalVotes > 0) {
      pctA = Math.round((votesA.length / totalVotes) * 100);
      pctB = 100 - pctA;
      pointsA = Math.round((votesA.length / totalVotes) * BASE_MATCHUP_POINTS);
      pointsB = BASE_MATCHUP_POINTS - pointsA;
    }

    const isSweepA = totalVotes >= 2 && votesB.length === 0;
    const isSweepB = totalVotes >= 2 && votesA.length === 0;

    if (isSweepA) pointsA += SWEEP_BONUS_POINTS;
    if (isSweepB) pointsB += SWEEP_BONUS_POINTS;

    // Apply scores to authoritative player objects
    if (room.players[duel.optionA.authorId]) {
      room.players[duel.optionA.authorId].score += pointsA;
    }
    if (room.players[duel.optionB.authorId]) {
      room.players[duel.optionB.authorId].score += pointsB;
    }

    const result: DuelResult = {
      votesA,
      votesB,
      pctA,
      pctB,
      pointsA,
      pointsB,
      isSweepA,
      isSweepB,
    };

    duel.isComplete = true;
    room.activeDuelResult = result;
    return result;
  }

  /**
   * Prepare client-specific scrubbed view (redacts author names during voting, redacts unassigned prompts).
   */
  public static getClientState(room: RoomState, playerId: string): ClientGameState {
    const isHost = room.players[playerId]?.isHost ?? false;
    const playerList = Object.values(room.players).map((p) => ({
      ...p,
    }));

    const clientState: ClientGameState = {
      roomCode: room.roomCode,
      phase: room.phase,
      phaseTimeRemaining: room.phaseTimeRemaining,
      phaseDuration: room.phaseDuration,
      round: room.round,
      selfPlayerId: playerId,
      isHost,
      players: playerList,
    };

    if (room.phase === 'WRITING') {
      const assignedIds = room.assignments[playerId] || [];
      clientState.activePrompts = room.prompts.filter((p) => assignedIds.includes(p.id));
      clientState.submittedPlayerIds = playerList.filter((p) => p.hasSubmitted).map((p) => p.id);
    }

    if (room.phase === 'DUEL_VOTING' || room.phase === 'DUEL_REVEAL') {
      const duel = room.duels[room.activeDuelIndex];
      if (duel) {
        const isAuthor = playerId === duel.optionA.authorId || playerId === duel.optionB.authorId;
        const totalVotesCast = Object.keys(duel.votes).length;

        clientState.currentDuel = {
          id: duel.id,
          promptText: duel.promptText,
          duelNumber: room.activeDuelIndex + 1,
          totalDuels: room.duels.length,
          optionA: {
            text: duel.optionA.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionA.authorNickname : undefined,
          },
          optionB: {
            text: duel.optionB.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionB.authorNickname : undefined,
          },
          canVote: !isAuthor && room.phase === 'DUEL_VOTING',
          myVote: duel.votes[playerId],
          totalVotesCast,
          totalEligibleVoters: duel.eligibleVoterIds.length,
          results: room.phase === 'DUEL_REVEAL' ? room.activeDuelResult : undefined,
        };
      }
    }

    if (room.phase === 'SCOREBOARD') {
      const ranked = [...playerList]
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({
          playerId: p.id,
          nickname: p.nickname,
          score: p.score,
          rank: idx + 1,
        }));
      clientState.leaderboard = ranked;
    }

    return clientState;
  }

  /**
   * Produce host/projector state view.
   */
  public static getHostState(room: RoomState): HostGameState {
    const playerList = Object.values(room.players);
    const submittedCount = playerList.filter((p) => p.hasSubmitted).length;

    const hostState: HostGameState = {
      roomCode: room.roomCode,
      phase: room.phase,
      phaseTimeRemaining: room.phaseTimeRemaining,
      round: room.round,
      players: playerList,
      submittedCount,
      totalPlayers: playerList.length,
    };

    if (room.phase === 'DUEL_VOTING' || room.phase === 'DUEL_REVEAL') {
      const duel = room.duels[room.activeDuelIndex];
      if (duel) {
        hostState.currentDuel = {
          id: duel.id,
          promptText: duel.promptText,
          duelNumber: room.activeDuelIndex + 1,
          totalDuels: room.duels.length,
          optionA: {
            text: duel.optionA.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionA.authorNickname : undefined,
          },
          optionB: {
            text: duel.optionB.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionB.authorNickname : undefined,
          },
          totalVotesCast: Object.keys(duel.votes).length,
          totalEligibleVoters: duel.eligibleVoterIds.length,
          results: room.phase === 'DUEL_REVEAL' ? room.activeDuelResult : undefined,
        };
      }
    }

    if (room.phase === 'SCOREBOARD') {
      hostState.leaderboard = [...playerList]
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({
          playerId: p.id,
          nickname: p.nickname,
          score: p.score,
          rank: idx + 1,
        }));
    }

    return hostState;
  }
}
