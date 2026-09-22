/**
 * scoringService.js
 *
 * Single place that decides how many points an answer is worth.
 * Everything here is a pure function: given the same inputs it always
 * returns the same output, and it never touches the database or the
 * network. That makes it trivial to unit test and easy to explain in
 * an interview - "the scoring rule lives in exactly one function".
 *
 * Rule (unchanged from the original project):
 *   - wrong answer  -> 0 points
 *   - correct answer -> 100 points, minus 2 points per second elapsed,
 *                        floored at 10 points so a correct answer is
 *                        never worth nothing.
 */

const BASE_POINTS = 100;
const POINTS_LOST_PER_SECOND = 2;
const MIN_POINTS_IF_CORRECT = 10;

/**
 * @param {boolean} isCorrect - whether the selected option matches correctAnswer
 * @param {number} elapsedMs - server-measured time between question start and submission
 * @returns {number} points to award (always 0 if isCorrect is false)
 */
function calculatePoints(isCorrect, elapsedMs) {
  if (!isCorrect) return 0;

  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const points = BASE_POINTS - elapsedSeconds * POINTS_LOST_PER_SECOND;

  return Math.max(points, MIN_POINTS_IF_CORRECT);
}

module.exports = { calculatePoints };
