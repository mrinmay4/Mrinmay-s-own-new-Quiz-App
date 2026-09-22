const express = require("express");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const createRoomSchema = z.object({
  quizId: z.string().uuid(),
  maxPlayers: z.number().int().min(2).max(100),
});

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

router.post("/create", authMiddleware, async (req, res) => {
  try {
    const data = createRoomSchema.parse(req.body);

    const quiz = await prisma.quiz.findUnique({ where: { id: data.quizId } });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    let code;
    let exists;
    do {
      code = generateRoomCode();
      exists = await prisma.room.findUnique({ where: { code } });
    } while (exists);

    const room = await prisma.room.create({
      data: {
        code,
        quizId: data.quizId,
        hostId: req.userId,
        maxPlayers: data.maxPlayers,
      },
    });

    res.status(201).json({ message: "Room created successfully", room });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input", details: err.issues });
    }
    console.error("Create room error:", err.message);
    res.status(500).json({ error: "Failed to create room" });
  }
});

/**
 * Thrown inside the join transaction when the room is at capacity.
 * Caught below and turned into a clean 400 response.
 */
class RoomFullError extends Error {}

/**
 * This is the ONLY place a Participant row gets created. Socket.IO's
 * "join-room" event deliberately does not create participants - it only
 * joins the live channel - so participant creation never happens twice.
 *
 * CONCURRENCY: without care, "count participants, then insert if under
 * capacity" has a race window - two requests can both count N (under the
 * limit), then both insert, overshooting maxPlayers. We don't want Redis
 * or an app-level distributed lock for this; Postgres already gives us
 * what we need via `SELECT ... FOR UPDATE` inside a transaction. That
 * statement takes a row-level lock on this specific Room row, so a
 * second concurrent join for the SAME room simply waits its turn at that
 * line until the first transaction commits (or rolls back) - the count
 * and the insert effectively become one atomic step. Joins to different
 * rooms are unaffected; they lock different rows.
 */
router.post("/join/:code", authMiddleware, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const participant = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${room.id} FOR UPDATE`;

      const existing = await tx.participant.findUnique({
        where: { userId_roomId: { userId: req.userId, roomId: room.id } },
      });
      if (existing) return existing; // already joined - idempotent, not an error

      const count = await tx.participant.count({ where: { roomId: room.id } });
      if (count >= room.maxPlayers) {
        throw new RoomFullError();
      }

      return tx.participant.create({
        data: { userId: req.userId, roomId: room.id },
      });
    });

    res.json({ message: "Joined room successfully", roomCode: code, participantId: participant.id });
  } catch (err) {
    if (err instanceof RoomFullError) {
      return res.status(400).json({ error: "Room is full" });
    }
    console.error("Join room error:", err.message);
    res.status(500).json({ error: "Failed to join room" });
  }
});

router.get("/:code", authMiddleware, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { code: req.params.code },
      select: { hostId: true, status: true, maxPlayers: true },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    res.json(room);
  } catch (err) {
    console.error("Get room error:", err.message);
    res.status(500).json({ error: "Failed to fetch room" });
  }
});

module.exports = router;
