import { Router } from "express";
import multer from "multer";
import { uploadPreview, generateExam } from "../controllers/examController";
import { validateBody } from "../middlewares/validate";
import { GenerateExamSchema } from "../validator/examSchemas";

const router = Router();
const upload = multer({ dest: "uploads/" });

router.post("/upload", upload.single("file"), uploadPreview);

// חשוב: multer צריך להיות לפני validateBody כדי ש-req.body יתמלא מ-form-data
router.post(
  "/generate",
  upload.single("file"),
  validateBody(GenerateExamSchema),
  generateExam
);

export default router;
