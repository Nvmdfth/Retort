import rawPrompts from './prompts.json';
import rawSafetyQuips from './safetyQuips.json';
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

export const WRITING_DURATION = 60; // seconds
export const VOTING_DURATION = 16;  // seconds
export const REVEAL_DURATION = 8;   // seconds

// Secret Roasts ("Quip Pro Quo")
const SECRET_ROASTS: Record<string, string> = {
  horse: 'Coincidentally, "Horse" is what a lazy party game player would type.',
  pee: 'Hey, party games are not a watersport.',
  urine: 'Hey, party games are not a watersport.',
  carefully: 'A careful seduction. Reminds me of the books my mom kept by the bathtub.',
  die: 'Actually, if you die there, you are both dead AND still there.',
  retort: 'Look at you, typing the name of the app. Did you want a cookie?',
  nothing: 'Nothing? Wow, really digging deep into the comedic archives for that one.',
};

function normalizeQuip(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/^the\s+|^a\s+|^an\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

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
  public static getRandomSafetyQuip(): string {
    const pool = rawSafetyQuips as string[];
    return pool[Math.floor(Math.random() * pool.length)];
  }

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
        isFinale: room.round >= 3,
      });
    }

    const assignments: Record<string, string[]> = {};
    playerList.forEach((p) => {
      assignments[p.id] = [];
      p.hasSubmitted = false;
    });

    if (n === 2) {
      // 2-player testing mode: both players receive both prompts
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
   * Tracks whether answer was generated via Safety Quip ("Write For Me").
   */
  public static recordAnswer(
    room: RoomState,
    playerId: string,
    promptId: string,
    rawText: unknown,
    isSafetyQuip = false
  ): { ok: boolean; allDone: boolean; error?: string; room: RoomState } {
    if (typeof rawText !== 'string' || typeof promptId !== 'string' || typeof playerId !== 'string') {
      return { ok: false, allDone: false, error: 'Invalid payload format', room };
    }

    if (playerId === '__proto__' || playerId === 'constructor' || playerId === 'prototype') {
      return { ok: false, allDone: false, error: 'Illegal player identifier', room };
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
      isSafetyQuip,
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
   * Handles:
   * 1. JINX! detection (duplicate answers).
   * 2. Forfeit detection (one player timed out).
   * 3. Secret roast triggers.
   */
  public static buildDuels(room: RoomState): Duel[] {
    const duels: Duel[] = [];
    const allPlayerIds = Object.keys(room.players);

    room.prompts.forEach((prompt, idx) => {
      const answersForPrompt = room.answers.filter((a) => a.promptId === prompt.id);
      
      const assignedPlayers = Object.entries(room.assignments)
        .filter(([, promptIds]) => promptIds.includes(prompt.id))
        .map(([pId]) => pId);

      if (assignedPlayers.length >= 2) {
        const pAId = assignedPlayers[0];
        const pBId = assignedPlayers[1];

        const ansA = answersForPrompt.find((a) => a.playerId === pAId);
        const ansB = answersForPrompt.find((a) => a.playerId === pBId);

        const hasAnsA = !!ansA;
        const hasAnsB = !!ansB;

        const authorA = room.players[pAId];
        const authorB = room.players[pBId];

        // Forfeit check: exactly one answered
        const isForfeit = (hasAnsA && !hasAnsB) || (!hasAnsA && hasAnsB);
        const forfeitWinnerId = isForfeit ? (hasAnsA ? pAId : pBId) : undefined;

        const textA = ansA?.text || '[Timed Out!]';
        const textB = ansB?.text || '[Timed Out!]';

        // JINX check: both submitted, normalized strings match
        const isJinx = hasAnsA && hasAnsB && normalizeQuip(textA) === normalizeQuip(textB);

        // Secret roasts ("Quip Pro Quo")
        const roastA = SECRET_ROASTS[normalizeQuip(textA)];
        const roastB = SECRET_ROASTS[normalizeQuip(textB)];

        // Eligible voters exclude the two authors
        const eligibleVoterIds = allPlayerIds.filter(
          (pid) => pid !== pAId && pid !== pBId && room.players[pid]?.isConnected
        );

        // Randomize Option A vs Option B
        const swap = Math.random() < 0.5;

        duels.push({
          id: `duel-${prompt.id}-${idx}`,
          promptId: prompt.id,
          promptText: prompt.text,
          round: room.round,
          optionA: {
            optionKey: 'A',
            authorId: swap ? pBId : pAId,
            text: swap ? textB : textA,
            authorNickname: (swap ? authorB : authorA)?.nickname || 'Player',
            isSafetyQuip: swap ? ansB?.isSafetyQuip : ansA?.isSafetyQuip,
            secretRoast: swap ? roastB : roastA,
          },
          optionB: {
            optionKey: 'B',
            authorId: swap ? pAId : pBId,
            text: swap ? textA : textB,
            authorNickname: (swap ? authorA : authorB)?.nickname || 'Player',
            isSafetyQuip: swap ? ansA?.isSafetyQuip : ansB?.isSafetyQuip,
            secretRoast: swap ? roastA : roastB,
          },
          eligibleVoterIds,
          votes: {},
          isJinx,
          isForfeit,
          forfeitWinnerId,
          isComplete: false,
        });
      }
    });

    return shuffleArray(duels);
  }

  /**
   * Cast vote on active duel.
   */
  public static castVote(
    room: RoomState,
    voterId: string,
    duelId: string,
    choice: unknown
  ): { ok: boolean; allVoted: boolean; error?: string; room: RoomState } {
    if (typeof voterId !== 'string' || typeof duelId !== 'string') {
      return { ok: false, allVoted: false, error: 'Invalid voter format', room };
    }

    if (voterId === '__proto__' || voterId === 'constructor' || voterId === 'prototype') {
      return { ok: false, allVoted: false, error: 'Illegal voter identifier', room };
    }

    if (choice !== 'A' && choice !== 'B') {
      return { ok: false, allVoted: false, error: 'Vote choice must be A or B', room };
    }

    const duel = room.duels[room.activeDuelIndex];
    if (!duel || duel.id !== duelId || duel.isComplete) {
      return { ok: false, allVoted: false, error: 'Active duel not found', room };
    }

    // Skip vote if JINX or Forfeit
    if (duel.isJinx || duel.isForfeit) {
      return { ok: false, allVoted: false, error: 'Voting is not open for this matchup', room };
    }

    // Author cannot vote on their own duel
    if (voterId === duel.optionA.authorId || voterId === duel.optionB.authorId) {
      return { ok: false, allVoted: false, error: 'Authors cannot vote on their own duel', room };
    }

    if (duel.eligibleVoterIds.length > 0 && !duel.eligibleVoterIds.includes(voterId)) {
      return { ok: false, allVoted: false, error: 'Not eligible to vote in this duel', room };
    }

    duel.votes[voterId] = choice;

    const votesCastCount = Object.keys(duel.votes).length;
    const allVoted = duel.eligibleVoterIds.length > 0 && votesCastCount >= duel.eligibleVoterIds.length;

    return { ok: true, allVoted, room };
  }

  /**
   * Tally votes for active duel using the official Quiplash mathematical formulas:
   * Round 1: 1,000 base pts, +100 winner bonus, +250 Quiplash sweep bonus
   * Round 2: 2,000 base pts (doubled), +200 winner bonus, +500 Quiplash sweep bonus
   * Round 3: 3,000 base pts (tripled), +750 Quiplash sweep bonus
   * Ties: Split 50/50, no winner bonus
   * Safety Quip: 50% penalty on all points earned
   * JINX: 0 points to both
   * Forfeit: 100% of base points to default winner, 0 to absent player
   */
  public static calculateDuelResult(room: RoomState): DuelResult {
    const duel = room.duels[room.activeDuelIndex];
    const multiplier = Math.min(room.round, 3); // 1, 2, or 3
    const basePool = 1000 * multiplier;
    const standardWinnerBonus = 100 * multiplier;
    const sweepBonus = 250 * multiplier;

    // Case 1: JINX!
    if (duel.isJinx) {
      duel.isComplete = true;
      const result: DuelResult = {
        isJinx: true,
        isForfeit: false,
        votesA: [],
        votesB: [],
        pctA: 0,
        pctB: 0,
        pointsA: 0,
        pointsB: 0,
        winnerKey: 'TIE',
        isSweepA: false,
        isSweepB: false,
      };
      room.activeDuelResult = result;
      return result;
    }

    // Case 2: Forfeit / Timeout
    if (duel.isForfeit) {
      duel.isComplete = true;
      const winnerIsA = duel.forfeitWinnerId === duel.optionA.authorId;
      let pointsA = winnerIsA ? basePool : 0;
      let pointsB = !winnerIsA ? basePool : 0;

      // Apply Safety Quip penalty if used
      if (winnerIsA && duel.optionA.isSafetyQuip) pointsA = Math.round(pointsA * 0.5);
      if (!winnerIsA && duel.optionB.isSafetyQuip) pointsB = Math.round(pointsB * 0.5);

      if (room.players[duel.optionA.authorId]) {
        room.players[duel.optionA.authorId].score += pointsA;
      }
      if (room.players[duel.optionB.authorId]) {
        room.players[duel.optionB.authorId].score += pointsB;
      }

      const result: DuelResult = {
        isJinx: false,
        isForfeit: true,
        votesA: [],
        votesB: [],
        pctA: winnerIsA ? 100 : 0,
        pctB: winnerIsA ? 0 : 100,
        pointsA,
        pointsB,
        winnerKey: winnerIsA ? 'A' : 'B',
        isSweepA: false,
        isSweepB: false,
        penaltyA: winnerIsA && !!duel.optionA.isSafetyQuip,
        penaltyB: !winnerIsA && !!duel.optionB.isSafetyQuip,
      };
      room.activeDuelResult = result;
      return result;
    }

    // Case 3: Standard Duel Vote Calculation
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
    let pointsA = Math.round(basePool / 2);
    let pointsB = Math.round(basePool / 2);
    let winnerKey: 'A' | 'B' | 'TIE' = 'TIE';
    let winnerBonus = 0;

    if (totalVotes > 0) {
      pctA = Math.round((votesA.length / totalVotes) * 100);
      pctB = 100 - pctA;
      pointsA = Math.round((votesA.length / totalVotes) * basePool);
      pointsB = basePool - pointsA;
    }

    // Quiplash Sweep condition (requires at least 2 voter votes for a sweep)
    const isSweepA = totalVotes >= 2 && votesB.length === 0;
    const isSweepB = totalVotes >= 2 && votesA.length === 0;

    if (pctA > pctB) {
      winnerKey = 'A';
      if (isSweepA) {
        pointsA += sweepBonus; // Replaces standard winner bonus
      } else {
        pointsA += standardWinnerBonus;
        winnerBonus = standardWinnerBonus;
      }
    } else if (pctB > pctA) {
      winnerKey = 'B';
      if (isSweepB) {
        pointsB += sweepBonus; // Replaces standard winner bonus
      } else {
        pointsB += standardWinnerBonus;
        winnerBonus = standardWinnerBonus;
      }
    } else {
      winnerKey = 'TIE'; // 50/50 tie, no winner bonus
    }

    // Apply Safety Quip penalty (50% reduction) if used
    const penaltyA = !!duel.optionA.isSafetyQuip;
    const penaltyB = !!duel.optionB.isSafetyQuip;

    if (penaltyA) pointsA = Math.round(pointsA * 0.5);
    if (penaltyB) pointsB = Math.round(pointsB * 0.5);

    // Apply points to player accounts
    if (room.players[duel.optionA.authorId]) {
      room.players[duel.optionA.authorId].score += pointsA;
    }
    if (room.players[duel.optionB.authorId]) {
      room.players[duel.optionB.authorId].score += pointsB;
    }

    const result: DuelResult = {
      isJinx: false,
      isForfeit: false,
      votesA,
      votesB,
      pctA,
      pctB,
      pointsA,
      pointsB,
      winnerKey,
      winnerBonus: winnerBonus > 0 ? winnerBonus : undefined,
      isSweepA,
      isSweepB,
      penaltyA,
      penaltyB,
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
    const playerList = Object.values(room.players).map((p) => ({ ...p }));
    const roundMultiplier = Math.min(room.round, 3);

    const clientState: ClientGameState = {
      roomCode: room.roomCode,
      phase: room.phase,
      phaseTimeRemaining: room.phaseTimeRemaining,
      phaseDuration: room.phaseDuration,
      round: room.round,
      roundMultiplier,
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
          isJinx: duel.isJinx,
          isForfeit: duel.isForfeit,
          optionA: {
            text: duel.optionA.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionA.authorNickname : undefined,
            isSafetyQuip: room.phase === 'DUEL_REVEAL' ? duel.optionA.isSafetyQuip : undefined,
            secretRoast: room.phase === 'DUEL_REVEAL' ? duel.optionA.secretRoast : undefined,
          },
          optionB: {
            text: duel.optionB.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionB.authorNickname : undefined,
            isSafetyQuip: room.phase === 'DUEL_REVEAL' ? duel.optionB.isSafetyQuip : undefined,
            secretRoast: room.phase === 'DUEL_REVEAL' ? duel.optionB.secretRoast : undefined,
          },
          canVote: !isAuthor && room.phase === 'DUEL_VOTING' && !duel.isJinx && !duel.isForfeit,
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
    const roundMultiplier = Math.min(room.round, 3);

    const hostState: HostGameState = {
      roomCode: room.roomCode,
      phase: room.phase,
      phaseTimeRemaining: room.phaseTimeRemaining,
      round: room.round,
      roundMultiplier,
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
          isJinx: duel.isJinx,
          isForfeit: duel.isForfeit,
          optionA: {
            text: duel.optionA.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionA.authorNickname : undefined,
            isSafetyQuip: room.phase === 'DUEL_REVEAL' ? duel.optionA.isSafetyQuip : undefined,
            secretRoast: room.phase === 'DUEL_REVEAL' ? duel.optionA.secretRoast : undefined,
          },
          optionB: {
            text: duel.optionB.text,
            authorNickname: room.phase === 'DUEL_REVEAL' ? duel.optionB.authorNickname : undefined,
            isSafetyQuip: room.phase === 'DUEL_REVEAL' ? duel.optionB.isSafetyQuip : undefined,
            secretRoast: room.phase === 'DUEL_REVEAL' ? duel.optionB.secretRoast : undefined,
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
