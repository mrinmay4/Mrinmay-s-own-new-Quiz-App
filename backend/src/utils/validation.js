/**
 * Zod schemas for Socket.IO event payloads. HTTP route bodies are
 * validated inline in their own route files - these are just for the
 * socket layer, kept in one place so every handler validates input the
 * same way instead of hand-rolling checks per event.
 */

const { z } = require("zod");

const roomCodeSchema = z.object({
  roomCode: z.string().trim().min(1),
});

const submitAnswerSchema = z.object({
  roomCode: z.string().trim().min(1),
  questionId: z.string().uuid(),
  answer: z.number().int().min(0),
});

/**
 * Parses `payload` against `schema`. Returns the parsed data on success.
 * On failure, emits a controlled "error" event back to the socket and
 * returns null so the caller can bail out early.
 */
function parseOrEmitError(socket, schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    socket.emit("error", { message: "Invalid request" });
    return null;
  }
  return result.data;
}

module.exports = { roomCodeSchema, submitAnswerSchema, parseOrEmitError };
