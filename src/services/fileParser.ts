import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

type MulterFile = Express.Multer.File;

type PdfParseFn = (data: Buffer) => Promise<{ text: string }>;

// pdf-parse יכול להגיע בצורות שונות לפי גרסה (fn / default / pdfParse / etc.)
const pdfParse = (() => {
  const mod = require("pdf-parse");

  // אם זה כבר פונקציה
  if (typeof mod === "function") return mod as PdfParseFn;

  // אם זה default
  if (mod?.default && typeof mod.default === "function")
    return mod.default as PdfParseFn;

  // אם זה export בשם pdfParse
  if (mod?.pdfParse && typeof mod.pdfParse === "function")
    return mod.pdfParse as PdfParseFn;

  // אם זה export בשם parse
  if (mod?.parse && typeof mod.parse === "function")
    return mod.parse as PdfParseFn;

  // ניסיון אחרון: חפש פונקציה כלשהי באובייקט
  const fn = Object.values(mod ?? {}).find((v) => typeof v === "function");
  if (typeof fn === "function") return fn as PdfParseFn;

  throw new Error(
    `pdf-parse loaded but no function export found. Keys: ${Object.keys(
      mod ?? {}
    ).join(", ")}`
  );
})();

export async function parseUploadedFile(file: MulterFile): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = await fs.readFile(file.path);

  if (file.mimetype === "application/pdf" || ext === ".pdf") {
    const data = await pdfParse(buffer);
    return cleanText(data.text);
  }

  if (file.mimetype.includes("word") || ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(result.value);
  }

  throw new Error("Unsupported file type. Please upload PDF or DOCX.");
}

function cleanText(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
