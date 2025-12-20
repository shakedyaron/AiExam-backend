import { z } from "zod";

export const ChoiceSchema = z.object({
  key: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1)
});

export const MCQQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.literal("mcq"),
  question: z.string().min(1),
  choices: z.array(ChoiceSchema).length(4),
  correctKey: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().min(1)
});

export const ExamResponseSchema = z.object({
  title: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  questions: z.array(MCQQuestionSchema).min(1).max(30)
});

export type ExamResponse = z.infer<typeof ExamResponseSchema>;
