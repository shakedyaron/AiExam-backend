import { openai } from "./openaiClient";
import { safeJsonParse } from "../utils/safeJson";
import {
  ExamResponseSchema,
  ExamResponse,
} from "../validator/examResponseSchema";

export type Difficulty = "easy" | "medium" | "hard";

function buildPrompt(
  text: string,
  numQuestions: number,
  difficulty: Difficulty
) {
  const clipped = text.slice(0, 12000);

  return `
You are an exam writer.
Create a multiple-choice exam ONLY from the provided source text.
Return VALID JSON ONLY (no markdown, no comments).

Rules:
- ${numQuestions} questions
- difficulty: ${difficulty}
- 4 choices per question (A,B,C,D)
- Exactly one correct answer
- Explanations must be based ONLY on the source text (no external knowledge)
- Language: Hebrew for question/choices/explanation
- IMPORTANT: Do NOT mention the source text in the question or explanation.
  Do NOT use phrases like "לפי הטקסט", "בהתבסס על הטקסט", "מהטקסט", "על פי הקטע".
  Just ask the question directly.

JSON schema:
{
  "title": string,
  "difficulty": "easy" | "medium" | "hard",
  "questions": [
    {
      "id": string,
      "type": "mcq",
      "question": string,
      "choices": [{"key":"A","text":string},{"key":"B","text":string},{"key":"C","text":string},{"key":"D","text":string}],
      "correctKey": "A"|"B"|"C"|"D",
      "explanation": string
    }
  ]
}

SOURCE TEXT:
"""
${clipped}
"""
`.trim();
}

async function callModel(prompt: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });

  return resp.choices[0]?.message?.content ?? "";
}

export async function generateExamFromText(args: {
  text: string;
  numQuestions: number;
  difficulty: Difficulty;
}): Promise<ExamResponse> {
  const prompt = buildPrompt(args.text, args.numQuestions, args.difficulty);

  let lastErr: any = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const content = await callModel(prompt);

      const parsed = safeJsonParse<unknown>(content);
      const validated = ExamResponseSchema.parse(parsed);

      // אם המודל החזיר difficulty שונה ממה שביקשנו, ניישר קו (אופציונלי)
      validated.difficulty = args.difficulty;

      return validated;
    } catch (err: any) {
      lastErr = err;
      console.warn(
        `[generateExamFromText] attempt ${attempt} failed:`,
        err?.message ?? err
      );
    }
  }

  throw new Error(
    `Failed to generate valid exam JSON: ${lastErr?.message ?? lastErr}`
  );
}
