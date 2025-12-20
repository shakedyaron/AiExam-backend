import { z } from "zod";

export const GenerateExamSchema = z.object({
  numQuestions: z.coerce.number().int().min(1).max(30).default(10),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});

export type GenerateExamDTO = z.infer<typeof GenerateExamSchema>;
