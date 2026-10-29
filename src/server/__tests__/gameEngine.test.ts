import { describe, expect, test } from 'bun:test';
import { GameEngine, VOTING_DURATION, INTERMISSION_DURATION, TOTAL_ROUNDS } from '../gameEngine';
import type { Player, RoomState } from '../../types/game';

describe('Retort GameEngine - Quiplash Specification Conformance', () => {
  const createMockPlayer = (id: string, nickname: string, isHost = false): Player => ({
    id,
    nickname,
    avatarSeed: id,
    score: 0,
    isHost,
    isConnected: true,
    hasSubmitted: false,
  });

  test('Ring Topology: N players receive circular prompt pairings', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');
    const p4 = createMockPlayer('p4', 'Diana');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room.players['p4'] = p4;

    room = GameEngine.startWritingPhase(room);

    expect(room.phase).toBe('WRITING');
    expect(room.prompts.length).toBe(4);

    // Each player receives exactly 2 prompts
    Object.values(room.assignments).forEach((assignedPromptIds) => {
      expect(assignedPromptIds.length).toBe(2);
    });

    // Each prompt is assigned to exactly 2 players
    room.prompts.forEach((prompt) => {
      const assignedCount = Object.values(room.assignments).filter((list) =>
        list.includes(prompt.id)
      ).length;
      expect(assignedCount).toBe(2);
    });
  });

  test('Scoring Mathematics: Round 1 (1000 base, +100 standard winner bonus, +250 sweep)', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');
    const p4 = createMockPlayer('p4', 'Diana');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room.players['p4'] = p4;

    room = GameEngine.startWritingPhase(room);

    // Fill all answers
    Object.entries(room.assignments).forEach(([playerId, promptIds]) => {
      promptIds.forEach((pid) => {
        GameEngine.recordAnswer(room, playerId, pid, `Quip ${playerId}`);
      });
    });

    room.duels = GameEngine.buildDuels(room);
    room.activeDuelIndex = 0;
    room.phase = 'DUEL_VOTING';

    const currentDuel = room.duels[0];
    const authorA = currentDuel.optionA.authorId;
    const authorB = currentDuel.optionB.authorId;
    const eligibleVoters = currentDuel.eligibleVoterIds;

    // Both voters vote for Option A -> 100% sweep in Round 1
    eligibleVoters.forEach((voterId) => {
      GameEngine.castVote(room, voterId, currentDuel.id, 'A');
    });

    const result = GameEngine.calculateDuelResult(room);
    expect(result.pctA).toBe(100);
    expect(result.isSweepA).toBe(true);
    // Round 1 sweep: 1000 base + 250 sweep bonus = 1250 pts
    expect(result.pointsA).toBe(1250);
    expect(result.pointsB).toBe(0);
    expect(room.players[authorA].score).toBe(1250);
    expect(room.players[authorB].score).toBe(0);
  });

  test('Scoring Mathematics: Round 2 Doubled Points (2000 base, +200 winner bonus, +500 sweep)', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');
    const p4 = createMockPlayer('p4', 'Diana');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.round = 2; // Round 2
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room.players['p4'] = p4;

    room = GameEngine.startWritingPhase(room);

    Object.entries(room.assignments).forEach(([playerId, promptIds]) => {
      promptIds.forEach((pid) => {
        GameEngine.recordAnswer(room, playerId, pid, `Round2 Quip ${playerId}`);
      });
    });

    room.duels = GameEngine.buildDuels(room);
    room.activeDuelIndex = 0;
    room.phase = 'DUEL_VOTING';

    const currentDuel = room.duels[0];
    const authorA = currentDuel.optionA.authorId;
    const eligibleVoters = currentDuel.eligibleVoterIds;

    // Unanimous vote in Round 2
    eligibleVoters.forEach((voterId) => {
      GameEngine.castVote(room, voterId, currentDuel.id, 'A');
    });

    const result = GameEngine.calculateDuelResult(room);
    expect(result.pctA).toBe(100);
    expect(result.isSweepA).toBe(true);
    // Round 2 sweep: 2000 base + 500 sweep bonus = 2500 pts
    expect(result.pointsA).toBe(2500);
    expect(room.players[authorA].score).toBe(2500);
  });

  test('JINX! Duplicate answers trigger alarm, cancel voting, award 0 points', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room = GameEngine.startWritingPhase(room);

    const promptId = room.prompts[0].id;
    // Both submit identical answer (ignoring case & articles)
    GameEngine.recordAnswer(room, 'p1', promptId, 'The Big Mac');
    GameEngine.recordAnswer(room, 'p2', promptId, 'big mac');

    room.duels = GameEngine.buildDuels(room);
    const duel = room.duels.find((d) => d.promptId === promptId);
    expect(duel?.isJinx).toBe(true);

    room.activeDuelIndex = room.duels.indexOf(duel!);
    const result = GameEngine.calculateDuelResult(room);
    expect(result.isJinx).toBe(true);
    expect(result.pointsA).toBe(0);
    expect(result.pointsB).toBe(0);
  });

  test('Safety Quip: Auto-filled quip incurs 50% penalty on all earned points', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');
    const p4 = createMockPlayer('p4', 'Diana');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room.players['p4'] = p4;
    room = GameEngine.startWritingPhase(room);

    // Player 1 uses Safety Quip
    Object.entries(room.assignments).forEach(([playerId, promptIds]) => {
      promptIds.forEach((pid) => {
        GameEngine.recordAnswer(
          room,
          playerId,
          pid,
          `Answer ${playerId}`,
          playerId === 'p1' // Safety quip for p1
        );
      });
    });

    room.duels = GameEngine.buildDuels(room);
    // Find duel where p1 is author
    const p1DuelIndex = room.duels.findIndex(
      (d) => d.optionA.authorId === 'p1' || d.optionB.authorId === 'p1'
    );
    room.activeDuelIndex = p1DuelIndex;
    const duel = room.duels[p1DuelIndex];
    const isP1OptionA = duel.optionA.authorId === 'p1';

    // Everyone votes for p1
    duel.eligibleVoterIds.forEach((voterId) => {
      GameEngine.castVote(room, voterId, duel.id, isP1OptionA ? 'A' : 'B');
    });

    const result = GameEngine.calculateDuelResult(room);
    // Normal 100% sweep = 1250 pts. With 50% safety quip penalty = 625 pts.
    const p1Points = isP1OptionA ? result.pointsA : result.pointsB;
    expect(p1Points).toBe(625);
    expect(room.players['p1'].score).toBe(625);
  });

  test('Forfeit / Timeout: Absent opponent awards default win without sweep bonus', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room = GameEngine.startWritingPhase(room);

    const promptId = room.prompts[0].id;
    // Only p1 answers, p2 times out
    GameEngine.recordAnswer(room, 'p1', promptId, 'Alice Answer');

    room.duels = GameEngine.buildDuels(room);
    const duel = room.duels.find((d) => d.promptId === promptId);
    expect(duel?.isForfeit).toBe(true);

    room.activeDuelIndex = room.duels.indexOf(duel!);
    const result = GameEngine.calculateDuelResult(room);
    expect(result.isForfeit).toBe(true);
    // Default win awards 100% of base points (1000) without sweep bonus
    const winnerPoints = duel?.optionA.authorId === 'p1' ? result.pointsA : result.pointsB;
    expect(winnerPoints).toBe(1000);
  });

  test('3-Round Lifecycle & Double Voting Timer (32s) per Quiplash specs', () => {
    // Voting duration must be doubled to 32 seconds
    expect(VOTING_DURATION).toBe(32);
    expect(INTERMISSION_DURATION).toBe(10);
    expect(TOTAL_ROUNDS).toBe(3);

    const p1 = createMockPlayer('p1', 'Alice', true);
    const room = GameEngine.createRoom('TEST', p1);

    expect(room.totalRounds).toBe(3);
    expect(room.isGameOver).toBe(false);
    expect(room.createdAt).toBeGreaterThan(0);

    const clientState = GameEngine.getClientState(room, 'p1');
    expect(clientState.totalRounds).toBe(3);
    expect(clientState.isGameOver).toBe(false);

    const hostState = GameEngine.getHostState(room);
    expect(hostState.totalRounds).toBe(3);
    expect(hostState.isGameOver).toBe(false);
  });

  test('Silent Admin Telemetry: Generates real-time inspection summary without affecting players', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');

    const room = GameEngine.createRoom('ADMN', p1);
    room.players['p2'] = p2;

    const summary = GameEngine.getAdminSummary(room);
    expect(summary.roomCode).toBe('ADMN');
    expect(summary.playerCount).toBe(2);
    expect(summary.activePlayers.length).toBe(2);
    expect(summary.round).toBe(1);
    expect(summary.totalRounds).toBe(3);
    expect(summary.isGameOver).toBe(false);
    expect(summary.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test('Idempotency: calculateDuelResult does not duplicate points when called multiple times', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');

    let room = GameEngine.createRoom('IDEM', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room = GameEngine.startWritingPhase(room);

    const promptId = room.prompts[0].id;
    GameEngine.recordAnswer(room, 'p1', promptId, 'Quip 1');
    GameEngine.recordAnswer(room, 'p2', promptId, 'Quip 2');

    room.duels = GameEngine.buildDuels(room);
    const duelIndex = room.duels.findIndex((d) => d.promptId === promptId);
    room.activeDuelIndex = duelIndex;
    const duel = room.duels[duelIndex];

    // Charlie votes for Option A
    GameEngine.castVote(room, 'p3', duel.id, 'A');

    // First calculation
    const res1 = GameEngine.calculateDuelResult(room);
    const scoreAfterFirst = room.players[duel.optionA.authorId].score;
    expect(scoreAfterFirst).toBeGreaterThan(0);

    // Second calculation (e.g. from timer expire or redundant event)
    const res2 = GameEngine.calculateDuelResult(room);
    const scoreAfterSecond = room.players[duel.optionA.authorId].score;

    expect(scoreAfterSecond).toBe(scoreAfterFirst);
    expect(res2).toEqual(res1);
  });

  test('Mutual Timeout: Neither player submitting answers awards 0 points to both', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');

    let room = GameEngine.createRoom('MUTL', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;
    room = GameEngine.startWritingPhase(room);
    const promptId = room.prompts[0].id;

    // Neither p1 nor p2 answers prompt 0
    room.duels = GameEngine.buildDuels(room);
    const duelIndex = room.duels.findIndex((d) => d.promptId === promptId);
    room.activeDuelIndex = duelIndex;
    const duel = room.duels[duelIndex];

    expect(duel.isForfeit).toBe(true);
    expect(duel.forfeitWinnerId).toBeUndefined();

    const result = GameEngine.calculateDuelResult(room);
    expect(result.pointsA).toBe(0);
    expect(result.pointsB).toBe(0);
    expect(result.winnerKey).toBe('TIE');
    expect(room.players[duel.optionA.authorId].score).toBe(0);
    expect(room.players[duel.optionB.authorId].score).toBe(0);
  });

  test('Multi-Round Progression & Round 3 Safety Quip Disabling', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');

    let room = GameEngine.createRoom('ROUN', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;

    // Round 1
    room = GameEngine.startWritingPhase(room);
    expect(room.round).toBe(1);
    expect(room.phase).toBe('WRITING');
    expect(room.prompts.length).toBe(3);

    // Round 2 progression
    room.round = 2;
    room = GameEngine.startWritingPhase(room);
    expect(room.round).toBe(2);
    expect(room.phase).toBe('WRITING');
    expect(room.prompts.every((p) => p.id.includes('prompt-2-'))).toBe(true);

    // Round 3 progression & safety quip disabled
    room.round = 3;
    room = GameEngine.startWritingPhase(room);
    expect(room.round).toBe(3);
    expect(room.phase).toBe('WRITING');
    expect(room.prompts.every((p) => p.isFinale === true)).toBe(true);

    // Submitting with safety quip in Round 3 should be stripped
    const promptId = room.assignments['p1'][0];
    const subRes = GameEngine.recordAnswer(room, 'p1', promptId, 'Finale Quip', true);
    expect(subRes.ok).toBe(true);
    const savedAnswer = room.answers.find((a) => a.playerId === 'p1');
    expect(savedAnswer?.isSafetyQuip).toBe(false);
  });
});
