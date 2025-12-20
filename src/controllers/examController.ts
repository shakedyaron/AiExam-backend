import { Request, Response } from "express";
import { parseUploadedFile } from "../services/fileParser";
import { generateExamFromText } from "../services/examGenerator";
import { GenerateExamDTO } from "../validator/examSchemas";

export async function uploadPreview(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    const text = await parseUploadedFile(req.file);
    return res.json({ chars: text.length, preview: text.slice(0, 800) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function generateExam(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    const { numQuestions, difficulty } = (req as any)
      .validatedBody as GenerateExamDTO;

    const text = await parseUploadedFile(req.file);

    // ✅ חישוב "כמה שאלות אפשר" לפי כמות מילים + כמות עובדות (מספרים/שנים/אחוזים)
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    // מספרים, אחוזים, שנים (למשל 2023), וגם מספרים כמו 1000+
    const factMatches = text.match(/\b(19|20)\d{2}\b|\d+%?|\d+\+/g) ?? [];
    const factCount = factMatches.length;

    // בסיס לפי מילים (80 מילים לשאלה בערך)
    const base = Math.floor(wordCount / 60);

    // בונוס לפי עובדות (כל 4 עובדות מוסיפות שאלה)
    const bonus = Math.floor(factCount / 4);

    // מקסימום שאלות שמותר
    const maxAllowed = Math.max(1, Math.min(30, base + bonus));

    if (numQuestions > maxAllowed) {
      return res.status(400).json({
        error: "NotEnoughContent",
        details: {
          wordCount,
          factCount,
          requested: numQuestions,
          maxAllowed,
          message: `הקובץ קצר/דל מדי בשביל ${numQuestions} שאלות. מקסימום מומלץ לפי התוכן: ${maxAllowed}.`,
        },
      });
    }

    const exam = await generateExamFromText({
      text,
      numQuestions,
      difficulty,
    });

    return res.json(exam);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}
