const express = require("express");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const authMiddleware = require("../middleware/authMiddleware");
const { generateAndValidateQuiz, createQuiz } = require("../services/quizService");

const router = express.Router();

const quizGenerationSchema = z.object({
  topic: z.string().trim().min(2),
  difficulty: z.enum(["easy", "medium", "hard"]),
  questionCount: z.number().int().min(1).max(10),
  timeLimit: z.number().int().min(10).max(60),
});

/**
 * POST /api/quiz/generate
 *
 * User provides topic/difficulty -> aiService calls the LLM -> quizService
 * validates + normalizes the result with Zod -> we persist the quiz.
 * If the AI output can't be validated, quizService throws and we return a
 * meaningful error instead of silently storing broken questions.
 */
router.post("/generate", authMiddleware, async (req, res) => {
  try {
    const data = quizGenerationSchema.parse(req.body);

    const questions = await generateAndValidateQuiz(
      data.topic,
      data.difficulty,
      data.questionCount
    );

    const quiz = await createQuiz({
      userId: req.userId,
      topic: data.topic,
      difficulty: data.difficulty,
      timeLimit: data.timeLimit,
      questions,
    });

    res.status(201).json(quiz);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input", details: err.issues });
    }
    console.error("Quiz generation error:", err.message);
    res.status(502).json({ error: "Failed to generate a valid quiz. Please try again." });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({
      where: { id: req.params.id },
      include: {
        questions: {
          select: { id: true, question: true, options: true },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    res.json(quiz);
  } catch (err) {
    console.error("Fetch quiz error:", err.message);
    res.status(500).json({ error: "Failed to fetch quiz" });
  }
});

module.exports = router;
