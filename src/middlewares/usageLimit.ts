import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../services/supabaseAdmin";
import { GenerateExamDTO } from "../validator/examSchemas";

export const PLAN_LIMITS = {
  free:    { examsPerMonth: 3,        maxQuestions: 10, allowOpenQuestions: false },
  student: { examsPerMonth: 30,       maxQuestions: 30, allowOpenQuestions: true  },
  pro:     { examsPerMonth: Infinity, maxQuestions: 45, allowOpenQuestions: true  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export async function checkUsageLimit(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as any).user;
  const { numQuestions, includeOpen } = (req as any).validatedBody as GenerateExamDTO;

  // Récupérer le plan de l'utilisateur
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const plan = (profile?.plan as Plan) ?? "free";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  // Vérifier l'accès aux questions ouvertes
  if (includeOpen && !limits.allowOpenQuestions) {
    return res.status(403).json({
      error: "PlanLimitExceeded",
      details: {
        reason: "openQuestions",
        message: "שאלות פתוחות זמינות רק במסלול Student או Pro.",
        plan,
      },
    });
  }

  // Vérifier la limite de questions
  if (numQuestions > limits.maxQuestions) {
    return res.status(403).json({
      error: "PlanLimitExceeded",
      details: {
        reason: "maxQuestions",
        message: `החבילה שלך מוגבל ל-${limits.maxQuestions} שאלות. שדרג לחבילה גבוה יותר.`,
        maxQuestions: limits.maxQuestions,
        plan,
      },
    });
  }

  // Vérifier la limite mensuelle
  const month = new Date().toISOString().slice(0, 7);
  const { data: usageRow } = await supabaseAdmin
    .from("usage")
    .select("exam_count")
    .eq("user_id", user.id)
    .eq("month", month)
    .maybeSingle();

  const examCount = usageRow?.exam_count ?? 0;

  if (limits.examsPerMonth !== Infinity && examCount >= limits.examsPerMonth) {
    return res.status(403).json({
      error: "PlanLimitExceeded",
      details: {
        reason: "monthlyLimit",
        message: `הגעת למגבלת ${limits.examsPerMonth} מבחנים לחודש זה. שדרג לחבילה גבוה יותר.`,
        examsPerMonth: limits.examsPerMonth,
        used: examCount,
        plan,
      },
    });
  }

  (req as any).plan = plan;
  (req as any).currentUsage = examCount;
  next();
}
