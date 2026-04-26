import { Router } from "express";
import multer from "multer";
import {
  uploadPreview, generateExam, generateDemoExam,
  getExamHistory, getExamDetail, saveExamScore,
  getUserInfo, evaluateAnswer, generateFromMistakes,
} from "../controllers/examController";
import { validateBody } from "../middlewares/validate";
import { GenerateExamSchema } from "../validator/examSchemas";
import { requireAuth } from "../middlewares/auth";
import { checkUsageLimit } from "../middlewares/usageLimit";

const router = Router();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
});

// Public
router.post("/upload", upload.array("files", 5), uploadPreview);
router.post("/generate-demo", validateBody(GenerateExamSchema), generateDemoExam);

// Authenticated
router.post("/generate", requireAuth, upload.array("files", 5), validateBody(GenerateExamSchema), checkUsageLimit, generateExam);
router.get("/history", requireAuth, getExamHistory);
router.get("/me", requireAuth, getUserInfo);
router.get("/exams/:examId", requireAuth, getExamDetail);
router.patch("/exams/:examId/score", requireAuth, saveExamScore);
router.post("/exams/:examId/generate-from-mistakes", requireAuth, checkUsageLimit, generateFromMistakes);
router.post("/evaluate", requireAuth, evaluateAnswer);

export default router;
