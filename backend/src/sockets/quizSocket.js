/**
 * quizSocket.js
 *
 * All Socket.IO event handlers live here. Business logic (scoring, active
 * game state) is delegated to services/ so this file stays focused on:
 *   1. validating input
 *   2. authenticating/authorizing the caller
 *   3. calling the right service
 *   4. emitting the right event(s)
 *
 * QUIZ STATE MACHINE (strict - no skipping steps)
 *   QUESTION STARTS -> answering window (server-timed) -> TIMER EXPIRES
 *   -> revealed = true, correct answer broadcast -> NEXT QUESTION allowed
 *   -> ... -> FINISHED
 *
 * There is exactly ONE mechanism that changes the current question: the
 * host's "next-question" event - and the server REJECTS it outright while
 * state.revealed is false. There is no way to skip a question early,
 * host included. "submit-answer" never advances the question or reveals
 * the correct answer - it only scores and stores the answer, and only
 * while the question's answering window is still open.
 *
 * Client -> Server events: join-room, start-quiz, submit-answer, next-question, leave-room
 * Server -> Client events: question, reveal-answer, answer-result (private, never includes correctAnswer), leaderboard-update, quiz-completed, error
 */

const prisma = require("../utils/prisma");
const roomService = require("../services/roomService");
const { calculatePoints } = require("../services/scoringService");
const { roomCodeSchema, submitAnswerSchema, parseOrEmitError } = require("../utils/validation");

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function getLeaderboard(roomId) {
  return prisma.participant.findMany({
    where: { roomId },
    include: { user: { select: { username: true } } },
    orderBy: { score: "desc" },
  });
}

/**
 * Schedules the ONE authoritative reveal timer for the room's current
 * question. Always clears any previous timer first, so a timer from an
 * old question can never fire against a newer one. This timer is the
 * ONLY thing that ever sets state.revealed = true.
 */
function scheduleReveal(io, roomCode, state, question, timeLimitSeconds) {
  roomService.clearRevealTimer(state);
  state.revealTimer = setTimeout(() => {
    state.revealTimer = null;
    state.revealed = true;
    io.to(roomCode).emit("reveal-answer", {
      questionId: question.id,
      correctAnswer: question.correctAnswer,
    });
  }, timeLimitSeconds * 1000);
}

/**
 * Broadcasts the room's current question and (re)starts the authoritative
 * timer for it. Used both when the quiz starts and on every next-question.
 */
function broadcastCurrentQuestion(io, roomCode, quiz, state) {
  const question = quiz.questions[state.currentQuestionIndex];
  state.questionStartTime = Date.now();
  state.revealed = false;

  io.to(roomCode).emit("question", {
    questionIndex: state.currentQuestionIndex,
    question: {
      id: question.id,
      question: question.question,
      options: question.options,
    },
    totalQuestions: quiz.questions.length,
    startTime: state.questionStartTime,
    timeLimit: quiz.timeLimit,
  });

  scheduleReveal(io, roomCode, state, question, quiz.timeLimit);
}

function registerQuizSocket(io) {
  io.on("connection", (socket) => {
    /* ============= JOIN ROOM =============
     * Participant creation is the HTTP room-join route's job (see
     * routes/room.js) - this only joins the Socket.IO channel and brings
     * the newly connected client up to date with live state.
     */
    socket.on("join-room", async (payload) => {
      const data = parseOrEmitError(socket, roomCodeSchema, payload);
      if (!data) return;
      const roomCode = normalizeRoomCode(data.roomCode);

      try {
        await socket.join(roomCode);

        const room = await prisma.room.findUnique({
          where: { code: roomCode },
          include: { quiz: { include: { questions: true } } },
        });
        if (!room) return socket.emit("error", { message: "Room not found" });

        const leaderboard = await getLeaderboard(room.id);
        io.to(roomCode).emit("leaderboard-update", leaderboard);

        // Reconnection: bring a rejoining client up to date with whatever
        // is currently happening in the room.
        const state = roomService.getRoomState(roomCode);
        if (room.status === "active" && state) {
          const question = room.quiz.questions[state.currentQuestionIndex];
          socket.emit("question", {
            questionIndex: state.currentQuestionIndex,
            question: { id: question.id, question: question.question, options: question.options },
            totalQuestions: room.quiz.questions.length,
            startTime: state.questionStartTime,
            timeLimit: room.quiz.timeLimit,
          });

          // If the answering window already closed before this client
          // (re)connected, also send the reveal so they see the actual
          // correct answer instead of an indefinite "waiting" state.
          if (state.revealed) {
            socket.emit("reveal-answer", {
              questionId: question.id,
              correctAnswer: question.correctAnswer,
            });
          }
        } else if (room.status === "finished") {
          socket.emit("quiz-completed");
        }
      } catch (err) {
        console.error("join-room error:", err.message);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    /* ============= START QUIZ (host only) ============= */
    socket.on("start-quiz", async (payload) => {
      const data = parseOrEmitError(socket, roomCodeSchema, payload);
      if (!data) return;
      const roomCode = normalizeRoomCode(data.roomCode);

      try {
        const room = await prisma.room.findUnique({
          where: { code: roomCode },
          include: { quiz: { include: { questions: true } } },
        });
        if (!room) return socket.emit("error", { message: "Room not found" });
        if (room.hostId !== socket.userId) {
          return socket.emit("error", { message: "Only the host can start the quiz" });
        }
        if (!room.quiz.questions.length) {
          return socket.emit("error", { message: "This quiz has no questions" });
        }
        if (roomService.getRoomState(roomCode)) {
          return socket.emit("error", { message: "Quiz is already in progress" });
        }

        const state = roomService.createRoomState(roomCode);

        await prisma.room.update({ where: { code: roomCode }, data: { status: "active" } });

        broadcastCurrentQuestion(io, roomCode, room.quiz, state);
      } catch (err) {
        console.error("start-quiz error:", err.message);
        socket.emit("error", { message: "Failed to start quiz" });
      }
    });

    /* ============= NEXT QUESTION (host only) =============
     * The ONLY place currentQuestionIndex changes - and it is REJECTED
     * outright while the current question hasn't been revealed yet. The
     * host cannot skip a question early; the answer must be revealed
     * (i.e. the server's timer must have expired) before this succeeds.
     */
    socket.on("next-question", async (payload) => {
      const data = parseOrEmitError(socket, roomCodeSchema, payload);
      if (!data) return;
      const roomCode = normalizeRoomCode(data.roomCode);

      try {
        const room = await prisma.room.findUnique({
          where: { code: roomCode },
          include: { quiz: { include: { questions: true } } },
        });
        if (!room) return socket.emit("error", { message: "Room not found" });
        if (room.hostId !== socket.userId) {
          return socket.emit("error", { message: "Only the host can advance the quiz" });
        }

        const state = roomService.getRoomState(roomCode);
        if (!state) return socket.emit("error", { message: "Quiz is not active" });

        if (!state.revealed) {
          return socket.emit("error", {
            message: "Wait for the answer to be revealed before moving to the next question",
          });
        }

        state.currentQuestionIndex += 1;

        if (state.currentQuestionIndex >= room.quiz.questions.length) {
          roomService.deleteRoomState(roomCode);
          await prisma.room.update({ where: { code: roomCode }, data: { status: "finished" } });
          io.to(roomCode).emit("quiz-completed");
        } else {
          broadcastCurrentQuestion(io, roomCode, room.quiz, state);
        }
      } catch (err) {
        console.error("next-question error:", err.message);
        socket.emit("error", { message: "Failed to advance to the next question" });
      }
    });

    /* ============= SUBMIT ANSWER =============
     * 1. validate request  2. verify participant  3. verify question
     * 4. reject if the answering window has closed  5. calculate score
     * (server-authoritative elapsed time)  6. store answer + update score
     * atomically  7. reply (never includes correctAnswer)  8. broadcast leaderboard
     * Never advances the question or reveals the answer - that only
     * happens when the server's own reveal timer fires.
     */
    socket.on("submit-answer", async (payload) => {
      const data = parseOrEmitError(socket, submitAnswerSchema, payload);
      if (!data) return;
      if (!socket.userId) return socket.emit("error", { message: "Authentication required" });

      const roomCode = normalizeRoomCode(data.roomCode);

      try {
        const state = roomService.getRoomState(roomCode);
        if (!state) return socket.emit("error", { message: "Quiz is not active" });

        const room = await prisma.room.findUnique({
          where: { code: roomCode },
          include: { quiz: { include: { questions: true } } },
        });
        if (!room) return socket.emit("error", { message: "Room not found" });

        // Verify question: must be the room's CURRENT question, not a
        // stale one from before the host called next-question.
        const currentQuestion = room.quiz.questions[state.currentQuestionIndex];
        if (!currentQuestion || currentQuestion.id !== data.questionId) {
          return socket.emit("error", { message: "This question is no longer active" });
        }

        // Server-authoritative time limit. Never trust a client-sent
        // elapsed value - measure from the server's own questionStartTime.
        // Checked two ways for the same underlying reason (belt and
        // suspenders): the explicit `revealed` flag, and the elapsed time
        // itself, in case a submission lands in the same tick the timer
        // fires but a hair before `revealed` was flipped.
        if (state.revealed) {
          return socket.emit("error", { message: "Time is up for this question" });
        }
        const elapsedMs = Date.now() - state.questionStartTime;
        const timeLimitMs = room.quiz.timeLimit * 1000;
        if (elapsedMs > timeLimitMs) {
          return socket.emit("error", { message: "Time is up for this question" });
        }

        // Verify participant
        const participant = await prisma.participant.findUnique({
          where: { userId_roomId: { userId: socket.userId, roomId: room.id } },
        });
        if (!participant) {
          return socket.emit("error", { message: "You are not a participant in this room" });
        }

        const isCorrect = Number(currentQuestion.correctAnswer) === Number(data.answer);
        const points = calculatePoints(isCorrect, elapsedMs);

        try {
          // One logical operation: store the answer AND update the score,
          // or neither happens. Score uses an atomic increment (not
          // read-modify-write in JS) so concurrent submissions from
          // different participants can never clobber each other.
          await prisma.$transaction([
            prisma.answer.create({
              data: {
                participantId: participant.id,
                questionId: currentQuestion.id,
                selectedAnswer: data.answer,
                isCorrect,
                points,
              },
            }),
            prisma.participant.update({
              where: { id: participant.id },
              data: { score: { increment: points } },
            }),
          ]);
        } catch (err) {
          if (err.code === "P2002") {
            // Unique constraint on (participantId, questionId) - already answered.
            return socket.emit("error", { message: "You have already answered this question" });
          }
          throw err;
        }

        // Deliberately does NOT include correctAnswer - the player learns
        // only whether their own pick was right. The actual correct
        // answer is revealed to everyone only once the timer expires.
        socket.emit("answer-result", {
          correct: isCorrect,
          points,
        });

        const leaderboard = await getLeaderboard(room.id);
        io.to(roomCode).emit("leaderboard-update", leaderboard);
      } catch (err) {
        console.error("submit-answer error:", err.message);
        socket.emit("error", { message: "Failed to submit answer" });
      }
    });

    socket.on("leave-room", (payload) => {
      const data = parseOrEmitError(socket, roomCodeSchema, payload);
      if (!data) return;
      socket.leave(normalizeRoomCode(data.roomCode));
    });

    socket.on("disconnect", () => {
      // Intentionally minimal: no presence tracking or distributed session
      // recovery. Socket.IO already leaves the socket's rooms for us, and
      // a client that comes back just re-emits join-room to reconnect.
    });
  });
}

module.exports = registerQuizSocket;
