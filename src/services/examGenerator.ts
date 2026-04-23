import { openai } from "./openaiClient";
import { safeJsonParse } from "../utils/safeJson";
import { ExamResponseSchema, ExamResponse } from "../validator/examResponseSchema";

export type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTY_INSTRUCTIONS: Record<Difficulty, string> = {
  easy: `- Most questions test basic recall and direct comprehension
- Distractors are clearly wrong but still related to the topic`,
  medium: `- Mix question types: ~30% recall, ~50% comprehension/comparison/cause-effect, ~20% application
- Distractors must be plausible — a student who half-understands the topic might pick them
- Avoid trivial questions whose answer is a single copied phrase`,
  hard: `- Prioritize application, analysis, and synthesis questions
- Distractors should be sophisticated — only a student with deep understanding can eliminate them
- Include questions that require combining two ideas from different parts of the text`,
};

function buildPrompt(text: string, numQuestions: number, difficulty: Difficulty, includeOpen: boolean) {
  const clipped = text.slice(0, 200000);

  const openCount = includeOpen ? Math.max(1, Math.floor(numQuestions * 0.5)) : 0;
  const mcqCount = numQuestions - openCount;

  const openSection = includeOpen ? `
- ${openCount} questions of type "open" (open-ended):
  - "keyPoints": array of 2-4 key points expected in the answer (each a short Hebrew phrase)
  - "modelAnswer": a complete model answer in Hebrew (2-4 sentences)` : "";

  return `
You are an expert exam writer and pedagogy specialist.
Create a high-quality exam ONLY from the provided source text.
Return VALID JSON ONLY (no markdown, no comments, no extra text).

DIFFICULTY LEVEL: ${difficulty}
${DIFFICULTY_INSTRUCTIONS[difficulty]}

MCQ QUESTION QUALITY RULES:
- Write questions that test UNDERSTANDING, not just copy-paste from text
- Use a variety of question types: definition, comparison, cause/effect, best-practice, application, exception
- Each question must have exactly ONE clearly correct answer
- The 3 wrong choices (distractors) must:
  * Be plausible and related to the topic
  * NOT be obviously absurd or off-topic
  * Each distractor should represent a common misconception or a close-but-wrong concept
- DISTRIBUTE correct answers across A/B/C/D positions — do NOT place the correct answer always as A
- Do NOT repeat very similar questions
- Do NOT use phrases like "לפי הטקסט" or "בהתבסס על הטקסט"

COUNTS:
- ${mcqCount} questions of type "mcq" (4 choices A/B/C/D)${openSection}
- Language: Hebrew for ALL text (questions, choices, explanations)

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
    },
    {
      "id": string,
      "type": "open",
      "question": string,
      "keyPoints": [string, ...],
      "modelAnswer": string
    }
  ]
}

SOURCE TEXT:
"""
${clipped}
"""
`.trim();
}

/* ── Shuffle MCQ choices to ensure correct answer is not always A ── */
function shuffleMCQChoices(validated: import("../validator/examResponseSchema").ExamResponse) {
  const keys: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

  validated.questions = validated.questions.map((q) => {
    if (q.type !== "mcq") return q;

    // Extract the correct answer text before shuffling
    const correctText = q.choices.find((c) => c.key === q.correctKey)?.text ?? "";

    // Fisher-Yates shuffle on the texts
    const texts = q.choices.map((c) => c.text);
    for (let i = texts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [texts[i], texts[j]] = [texts[j], texts[i]];
    }

    // Rebuild choices with fixed A/B/C/D keys
    const newChoices = keys.map((key, i) => ({ key, text: texts[i] }));

    // Recalculate which key is now correct
    const newCorrectKey = newChoices.find((c) => c.text === correctText)?.key ?? q.correctKey;

    return { ...q, choices: newChoices, correctKey: newCorrectKey };
  });

  return validated;
}

async function callModel(prompt: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0]?.message?.content ?? "";
}

export async function generateExamFromText(args: {
  text: string;
  numQuestions: number;
  difficulty: Difficulty;
  includeOpen: boolean;
}): Promise<ExamResponse> {
  const prompt = buildPrompt(args.text, args.numQuestions, args.difficulty, args.includeOpen);
  let lastErr: any = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const content = await callModel(prompt);
      const parsed = safeJsonParse<unknown>(content);
      const validated = ExamResponseSchema.parse(parsed);
      validated.difficulty = args.difficulty;
      return shuffleMCQChoices(validated);
    } catch (err: any) {
      lastErr = err;
      console.warn(`[generateExamFromText] attempt ${attempt} failed:`, err?.message ?? err);
    }
  }

  throw new Error(`Failed to generate valid exam JSON: ${lastErr?.message ?? lastErr}`);
}

export async function evaluateOpenAnswer(args: {
  question: string;
  keyPoints: string[];
  modelAnswer: string;
  userAnswer: string;
}): Promise<{ score: number; feedback: string }> {
  const prompt = `
אתה מורה שמעריך תשובות של תלמידים.
שאלה: ${args.question}
נקודות מפתח שצריכות להופיע: ${args.keyPoints.join(", ")}
תשובה מודל: ${args.modelAnswer}
תשובת התלמיד: ${args.userAnswer}

הערך את התשובה ותן ציון מ-0 עד 100.
החזר JSON תקני בלבד: {"score": number, "feedback": string}
ה-feedback בעברית, קצר (2-3 משפטים), מציין מה היה טוב ומה חסר.
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const content = resp.choices[0]?.message?.content ?? "";
  const parsed = safeJsonParse<{ score: number; feedback: string }>(content);

  if (typeof parsed?.score !== "number" || typeof parsed?.feedback !== "string") {
    throw new Error("Invalid evaluation response from AI");
  }

  return { score: Math.max(0, Math.min(100, parsed.score)), feedback: parsed.feedback };
}
