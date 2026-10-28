import { describe, expect, test } from 'bun:test';
import { GameEngine } from '../gameEngine';
import type { Player, RoomState } from '../../types/game';

describe('Retort GameEngine', () => {
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

  test('Submissions & Duel Building', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;

    room = GameEngine.startWritingPhase(room);

    // Submit answers for all assignments
    Object.entries(room.assignments).forEach(([playerId, promptIds]) => {
      promptIds.forEach((pid) => {
        const { allDone } = GameEngine.recordAnswer(
          room,
          playerId,
          pid,
          `Answer from ${playerId}`
        );
        if (playerId === 'p3' && pid === promptIds[promptIds.length - 1]) {
          expect(allDone).toBe(true);
        }
      });
    });

    const duels = GameEngine.buildDuels(room);
    expect(duels.length).toBe(3);

    duels.forEach((duel) => {
      expect(duel.optionA.text).toBeTruthy();
      expect(duel.optionB.text).toBeTruthy();
      // Eligible voters excludes authors
      expect(duel.eligibleVoterIds).not.toContain(duel.optionA.authorId);
      expect(duel.eligibleVoterIds).not.toContain(duel.optionB.authorId);
    });
  });

  test('Voting, Clean Sweep Bonus & Author Lockout', () => {
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
    const eligibleVoters = currentDuel.eligibleVoterIds;

    // Author cannot vote on their own duel
    const { allVoted: authorVoteResult } = GameEngine.castVote(
      room,
      authorA,
      currentDuel.id,
      'A'
    );
    expect(authorVoteResult).toBe(false);
    expect(currentDuel.votes[authorA]).toBeUndefined();

    // Eligible voters vote unanimously for Option A
    eligibleVoters.forEach((voterId) => {
      GameEngine.castVote(room, voterId, currentDuel.id, 'A');
    });

    // Calculate result
    const result = GameEngine.calculateDuelResult(room);
    expect(result.pctA).toBe(100);
    expect(result.pctB).toBe(0);
    expect(result.isSweepA).toBe(true);
    // 1000 base + 250 sweep bonus
    expect(result.pointsA).toBe(1250);
    expect(room.players[authorA].score).toBe(1250);
  });

  test('Scrubbed Client State prevents cheating', () => {
    const p1 = createMockPlayer('p1', 'Alice', true);
    const p2 = createMockPlayer('p2', 'Bob');
    const p3 = createMockPlayer('p3', 'Charlie');

    let room: RoomState = GameEngine.createRoom('TEST', p1);
    room.players['p2'] = p2;
    room.players['p3'] = p3;

    room = GameEngine.startWritingPhase(room);

    // In WRITING phase: Player 1 only receives their assigned prompts, not all prompts in the room
    const p1WritingState = GameEngine.getClientState(room, 'p1');
    expect(p1WritingState.activePrompts?.length).toBe(2);

    // Setup DUEL_VOTING
    Object.entries(room.assignments).forEach(([playerId, promptIds]) => {
      promptIds.forEach((pid) => {
        GameEngine.recordAnswer(room, playerId, pid, `Joke ${playerId}`);
      });
    });
    room.duels = GameEngine.buildDuels(room);
    room.activeDuelIndex = 0;
    room.phase = 'DUEL_VOTING';

    const p1VotingState = GameEngine.getClientState(room, 'p1');
    // Author names must be redacted during voting
    expect(p1VotingState.currentDuel?.optionA.authorNickname).toBeUndefined();
    expect(p1VotingState.currentDuel?.optionB.authorNickname).toBeUndefined();

    // In DUEL_REVEAL: Author names become visible
    room.phase = 'DUEL_REVEAL';
    GameEngine.calculateDuelResult(room);
    const p1RevealState = GameEngine.getClientState(room, 'p1');
    expect(p1RevealState.currentDuel?.optionA.authorNickname).toBeDefined();
    expect(p1RevealState.currentDuel?.results).toBeDefined();
  });
});
