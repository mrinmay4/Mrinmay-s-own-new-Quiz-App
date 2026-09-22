/**
 * quizService.js
 *
 * The AI (aiService.generateQuiz) is only responsible for generating
 * candidate questions. This service is responsible for validating and
 * normalizing that output before anything is written to Postgres.
 *
 * Flow:
 *   topic/difficulty/count -> aiService (LLM call)
 *                          -> normalizeQuestion() per question (Zod + index resolution)
 *                          -> prisma.quiz.create()
 *
 * The important rule enforced here: if the AI's "correct answer" can't be
 * resolved to a valid option index, we REJECT that question instead of
 * silently defaulting to index 0. Defaulting to 0 would let a broken
 * question look fine while scoring every participant against the wrong
 * answer - a bug that's invisible until someone notices the "correct"
 * option is wrong.
 */

const { z } = require("zod");
const prisma = require("../utils/prisma");
const generateQuiz = require("./aiService");

// Shape required from a single raw AI-generated question, before we've
// resolved which option is correct.
const rawAiQuestionSchema = z.object({
  question: z.string().trim().min(3),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correctAnswer: z.union([z.number(), z.string()]).optional(),
  answer: z.string().optional(),
  explanation: z.string().optional().default(""),
});

/**
 * Tries to resolve the AI's correct-answer field into a 0-based option
 * index. Accepts a numeric index, a numeric string ("2"), a letter
 * ("B"), or the option's own text. Returns null if none of those work.
 */
function resolveCorrectIndex(data) {
  if (typeof data.correctAnswer === "number" && Number.isInteger(data.correctAnswer)) {
    return data.correctAnswer;
  }

  if (typeof data.correctAnswer === "string" && /^\d+$/.test(data.correctAnswer.trim())) {
    return Number(data.correctAnswer.trim());
  }

  const answerText =
    typeof data.answer === "string" && data.answer.trim()
      ? data.answer.trim()
      : typeof data.correctAnswer === "string"
      ? data.correctAnswer.trim()
      : "";

  if (!answerText) return null;

  // Single letter, e.g. "B" -> 1
  if (answerText.length === 1 && /^[A-Za-z]$/.test(answerText)) {
    return answerText.toUpperCase().charCodeAt(0) - 65;
  }

  // Fall back to matching the option's own text
  const index = data.options.findIndex(
    (opt) => opt.trim().toLowerCase() === answerText.toLowerCase()
  );
  return index === -1 ? null : index;
}

function normalizeQuestion(raw, position) {
  const parsed = rawAiQuestionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `AI question ${position + 1} is malformed: ${parsed.error.issues[0]?.message}`
    );
  }

  const data = parsed.data;
  const correctIndex = resolveCorrectIndex(data);

  if (correctIndex === null || correctIndex < 0 || correctIndex >= data.options.length) {
    throw new Error(
      `AI question ${position + 1} ("${data.question}") has no resolvable correct answer`
    );
  }

  return {
    question: data.question,
    options: data.options,
    correctAnswer: correctIndex,
    explanation: data.explanation || "",
  };
}

/**
 * Calls the LLM, then validates and normalizes every question it returned.
 * Throws (rejecting the whole generation) if the AI response is not an
 * array, is empty, or contains even one unusable question.
 */
async function generateAndValidateQuiz(topic, difficulty, questionCount) {
  const rawQuestions = await generateQuiz(topic, difficulty, questionCount);

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("AI returned no usable questions");
  }

  return rawQuestions.map((raw, position) => normalizeQuestion(raw, position));
}

async function createQuiz({ userId, topic, difficulty, timeLimit, questions }) {
  return prisma.quiz.create({
    data: {
      topic,
      difficulty,
      timeLimit,
      userId,
      questions: { create: questions },
    },
    include: { questions: true },
  });
}

module.exports = { generateAndValidateQuiz, createQuiz };
