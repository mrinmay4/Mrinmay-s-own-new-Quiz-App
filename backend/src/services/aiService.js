const axios = require("axios");

async function generateQuiz(topic, difficulty, questionCount) {
  const prompt = `
Generate ${questionCount} multiple choice questions about "${topic}".
Difficulty: ${difficulty}.

Return ONLY a valid JSON array.
Do NOT use markdown.
Do NOT include explanations outside JSON.
Escape all quotes properly.
`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let text = response.data.choices[0].message.content;

    // Remove markdown if exists
    text = text.replace(/```json|```/g, "").trim();

    // Extract JSON array safely
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");

    if (firstBracket === -1 || lastBracket === -1) {
      throw new Error("AI did not return JSON array");
    }

    const jsonString = text.substring(firstBracket, lastBracket + 1);

    const parsed = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) {
      throw new Error("AI returned invalid JSON structure");
    }

    return parsed;

  } catch (error) {
    console.error("AI ERROR:", error.message);
    throw new Error("Failed to generate quiz");
  }
}

module.exports = generateQuiz;
