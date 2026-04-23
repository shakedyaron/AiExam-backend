import { Request, Response } from "express";
import { parseMultipleFiles, parseMultipleFilesAsArray } from "../services/fileParser";
import { generateExamFromText, evaluateOpenAnswer } from "../services/examGenerator";
import { GenerateExamDTO } from "../validator/examSchemas";
import { supabaseAdmin } from "../services/supabaseAdmin";

const DEMO_TEXT = `
כדור הארץ מחולק לשבע יבשות: אסיה, אפריקה, אירופה, אמריקה הצפונית,
אמריקה הדרומית, אוסטרליה ואנטארקטיקה.
האוקיינוס השקט הוא האוקיינוס הגדול ביותר בעולם.
נהר הנילוס נחשב לאחד הנהרות הארוכים בעולם.
מדבר הסהרה הוא המדבר החם הגדול ביותר בכדור הארץ.
רוב אוכלוסיית העולם מתגוררת ביבשת אסיה.
`;

export async function uploadPreview(req: Request, res: Response) {
  try {
    const files = (req.files as Express.Multer.File[]) ?? (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ error: "Missing file" });
    const text = await parseMultipleFiles(files);
    return res.json({ chars: text.length, preview: text.slice(0, 800) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

function distributeQuestions(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export async function generateExam(req: Request, res: Response) {
  try {
    const files = (req.files as Express.Multer.File[]) ?? (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ error: "Missing file" });

    const { numQuestions, difficulty, includeOpen } = (req as any).validatedBody as GenerateExamDTO;
    const user = (req as any).user;

    // Parse each file individually to enable per-file question distribution
    const fileTexts = await parseMultipleFilesAsArray(files);
    const combinedText = fileTexts.join("\n\n");

    // Content validation on combined text
    const wordCount = combinedText.trim().split(/\s+/).filter(Boolean).length;
    const factMatches = combinedText.match(/\b(19|20)\d{2}\b|\d+%?|\d+\+/g) ?? [];
    const factCount = factMatches.length;
    const base = Math.floor(wordCount / 60);
    const bonus = Math.floor(factCount / 4);
    const maxAllowed = Math.max(1, Math.min(45, base + bonus));

    if (numQuestions > maxAllowed) {
      return res.status(400).json({
        error: "NotEnoughContent",
        details: {
          wordCount, factCount, requested: numQuestions, maxAllowed,
          message: `הקובץ קצר/דל מדי בשביל ${numQuestions} שאלות. מקסימום מומלץ: ${maxAllowed}.`,
        },
      });
    }

    // Generate questions: single file → one call, multiple files → one call per file
    let allQuestions: any[] = [];
    const titles: string[] = [];

    if (fileTexts.length === 1) {
      const exam = await generateExamFromText({ text: fileTexts[0], numQuestions, difficulty, includeOpen });
      allQuestions = [...exam.questions];
      titles.push(exam.title);
    } else {
      const counts = distributeQuestions(numQuestions, fileTexts.length);
      for (let i = 0; i < fileTexts.length; i++) {
        const subExam = await generateExamFromText({
          text: fileTexts[i],
          numQuestions: counts[i],
          difficulty,
          includeOpen,
        });
        allQuestions.push(...subExam.questions);
        titles.push(subExam.title);
      }
      // Interleave questions from different files (Fisher-Yates shuffle)
      for (let i = allQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
      }
    }

    // Reassign sequential IDs to avoid duplicates from multiple sub-exams
    allQuestions = allQuestions.slice(0, numQuestions);
    allQuestions.forEach((q, i) => { q.id = `q${i + 1}`; });

    const finalTitle = titles.length === 1 ? titles[0] : titles.join(" | ");
    const exam = { title: finalTitle, difficulty, questions: allQuestions };

    const month = new Date().toISOString().slice(0, 7);
    const [insertResult, rpcResult] = await Promise.all([
      supabaseAdmin
        .from("exams")
        .insert({ user_id: user.id, title: exam.title, difficulty: exam.difficulty, questions: exam.questions })
        .select("id")
        .single(),
      supabaseAdmin.rpc("increment_usage", { p_user_id: user.id, p_month: month }),
    ]);

    if (insertResult.error) console.error("[generateExam] exam insert failed:", insertResult.error);
    if (rpcResult.error) console.error("[generateExam] increment_usage failed:", rpcResult.error);

    return res.json({ ...exam, examId: insertResult.data?.id ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function generateDemoExam(req: Request, res: Response) {
  try {
    const { numQuestions, difficulty, includeOpen } = (req as any).validatedBody as GenerateExamDTO;
    const exam = await generateExamFromText({ text: DEMO_TEXT, numQuestions, difficulty, includeOpen });
    return res.json(exam);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function getExamHistory(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { data, error } = await supabaseAdmin
      .from("exams")
      .select("id, title, difficulty, score, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function getExamDetail(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { examId } = req.params;
    const { data, error } = await supabaseAdmin
      .from("exams")
      .select("id, title, difficulty, score, questions, created_at")
      .eq("id", examId)
      .eq("user_id", user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: "Exam not found" });
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function saveExamScore(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { examId } = req.params;
    const { score, mcqAnswers } = req.body;
    if (!score || typeof score.correct !== "number" || typeof score.total !== "number") {
      return res.status(400).json({ error: "Invalid score" });
    }
    const scoreData = mcqAnswers ? { ...score, mcqAnswers } : score;

    const { error } = await supabaseAdmin
      .from("exams").update({ score: scoreData }).eq("id", examId).eq("user_id", user.id);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function generateFromMistakes(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const { examId } = req.params;
    const numQuestions: number = Number(req.body.numQuestions) || 5;

    const { data: exam } = await supabaseAdmin
      .from("exams")
      .select("*")
      .eq("id", examId)
      .eq("user_id", user.id)
      .single();

    if (!exam) return res.status(404).json({ error: "Exam not found" });

    const mcqAnswers: Record<string, string> = exam.score?.mcqAnswers ?? {};
    const questions: any[] = exam.questions ?? [];

    const wrongQuestions = questions.filter(
      (q) => q.type === "mcq" && mcqAnswers[q.id] && mcqAnswers[q.id] !== q.correctKey
    );

    // Build text — from wrong answers if available, else from all questions (general review)
    let text: string;
    let count: number;
    let isFallback = false;

    if (wrongQuestions.length > 0) {
      const mistakesText = wrongQuestions.map((q) => {
        const correct = q.choices?.find((c: any) => c.key === q.correctKey);
        return `שאלה: ${q.question}\nתשובה נכונה: ${correct?.text ?? ""}\nהסבר: ${q.explanation ?? ""}`;
      }).join("\n\n");
      text = `הנושאים הבאים היו שגויים במבחן "${exam.title}":\n\n${mistakesText}`;
      count = Math.min(numQuestions, wrongQuestions.length * 2, 15);
    } else {
      // Fallback: build review text from all exam questions
      isFallback = true;
      const reviewLines = (questions as any[]).map((q) => {
        if (q.type === "mcq") {
          const correct = q.choices?.find((c: any) => c.key === q.correctKey);
          return `שאלה: ${q.question}\nתשובה: ${correct?.text ?? ""}\nהסבר: ${q.explanation ?? ""}`;
        }
        return `שאלה: ${q.question}\n${q.modelAnswer ?? (q.keyPoints ?? []).join(", ")}`;
      });
      text = reviewLines.length > 0
        ? `חזרה כללית על המבחן "${exam.title}":\n\n${reviewLines.join("\n\n")}`
        : `חזרה כללית על הנושא: ${exam.title}. הנושא מכסה נקודות עיקריות הדורשות הבנה מעמיקה.`;
      count = Math.min(numQuestions, Math.max(questions.length, 3), 10);
    }

    const newExam = await generateExamFromText({
      text, numQuestions: count, difficulty: exam.difficulty, includeOpen: false,
    });

    const title = isFallback
      ? `חזרה כללית: ${exam.title}`
      : `חזרה על טעויות: ${exam.title}`;

    // Insert without score — will only appear in history after user submits
    const insertResult = await supabaseAdmin.from("exams")
      .insert({ user_id: user.id, title, difficulty: exam.difficulty, questions: newExam.questions })
      .select("id").single();

    return res.json({ ...newExam, title, examId: insertResult.data?.id ?? null, fallback: isFallback });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function getUserInfo(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const month = new Date().toISOString().slice(0, 7);
    const [{ data: profile }, { data: usageRow }] = await Promise.all([
      supabaseAdmin.from("profiles").select("plan").eq("id", user.id).single(),
      supabaseAdmin.from("usage").select("exam_count").eq("user_id", user.id).eq("month", month).maybeSingle(),
    ]);
    return res.json({ plan: profile?.plan ?? "free", usedThisMonth: usageRow?.exam_count ?? 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

export async function evaluateAnswer(req: Request, res: Response) {
  try {
    const { question, keyPoints, modelAnswer, userAnswer } = req.body;
    if (!question || !keyPoints || !userAnswer) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const result = await evaluateOpenAnswer({ question, keyPoints, modelAnswer, userAnswer });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}
