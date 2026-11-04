import type { Player, RoomState } from '../types/game';

/**
 * Moves a returning player's seat from their old socket id to a new one, rewriting every
 * place the engine keys state by player id (assignments, answers, duels, votes, deltas).
 */
export function reclaimSeat(room: RoomState, player: Player, newId: string) {
  const oldId = player.id;
  delete room.players[oldId];
  player.id = newId;
  player.isConnected = true;
  room.players[newId] = player;
  // Re-assign prompt assignments
  if (room.assignments[oldId]) {
    const assigned = room.assignments[oldId];
    delete room.assignments[oldId];
    room.assignments[newId] = assigned;
  }
  // Re-assign submitted answers
  room.answers.forEach((ans) => {
    if (ans.playerId === oldId) ans.playerId = newId;
  });
  // Re-assign duel authorships, eligible voters, forfeit winners, and votes
  room.duels.forEach((duel) => {
    if (duel.optionA.authorId === oldId) duel.optionA.authorId = newId;
    if (duel.optionB.authorId === oldId) duel.optionB.authorId = newId;
    if (duel.forfeitWinnerId === oldId) duel.forfeitWinnerId = newId;
    duel.eligibleVoterIds = duel.eligibleVoterIds.map((id) => (id === oldId ? newId : id));
    if (duel.votes[oldId]) {
      const choice = duel.votes[oldId];
      delete duel.votes[oldId];
      duel.votes[newId] = choice;
    }
  });
  if (room.activeDuelResult) {
    room.activeDuelResult.votesA.forEach((v) => { if (v.id === oldId) v.id = newId; });
    room.activeDuelResult.votesB.forEach((v) => { if (v.id === oldId) v.id = newId; });
  }
  room.recentScoreDeltas.forEach((d) => {
    if (d.playerId === oldId) d.playerId = newId;
  });
}
