/**
 * roomService.js
 *
 * ACTIVE GAME STATE lives here, in a plain in-memory Map:
 *
 *   roomCode -> {
 *     currentQuestionIndex,
 *     questionStartTime,   // server Date.now() when the current question opened
 *     revealed,             // false until the answer timer expires for this question
 *     status,               // "active" | "finished"
 *     revealTimer,          // Timeout handle for the current question's reveal
 *   }
 *
 * PERSISTENT STATE (users, rooms, quizzes, questions, participants, answers)
 * lives in PostgreSQL via Prisma - see prisma/schema.prisma.
 *
 * Important limitation, stated explicitly rather than hidden: this Map only
 * exists inside a single Node.js process. It is NOT shared across multiple
 * backend instances. Running more than one instance of this server behind a
 * load balancer would split rooms across processes with no way to see each
 * other's state. That's fine for this project (one Node process), but it's
 * the reason a production version would need shared state (e.g. a Redis
 * adapter for Socket.IO, or moving this Map into Redis) - see the README's
 * "Scalability" section.
 */

const rooms = new Map();

function createRoomState(roomCode) {
  const state = {
    currentQuestionIndex: 0,
    questionStartTime: null,
    revealed: false,
    status: "active",
    revealTimer: null,
  };
  rooms.set(roomCode, state);
  return state;
}

function getRoomState(roomCode) {
  return rooms.get(roomCode) || null;
}

/**
 * Clears whatever reveal timer is currently scheduled for a room, if any.
 * Always call this before scheduling a new one, and before deleting the
 * room's state - otherwise an old timer can fire after the room has moved
 * on (the exact race condition this refactor removes).
 */
function clearRevealTimer(state) {
  if (state?.revealTimer) {
    clearTimeout(state.revealTimer);
    state.revealTimer = null;
  }
}

function deleteRoomState(roomCode) {
  const state = rooms.get(roomCode);
  clearRevealTimer(state);
  rooms.delete(roomCode);
}

module.exports = {
  createRoomState,
  getRoomState,
  clearRevealTimer,
  deleteRoomState,
};
