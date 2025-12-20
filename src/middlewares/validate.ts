import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "ValidationError",
        details: result.error.flatten()
      });
    }

    // שומרים את ה-DTO המנוקה לשימוש ב-controller
    (req as any).validatedBody = result.data;
    next();
  };
}
