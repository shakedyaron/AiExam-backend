import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

type MulterFile = Express.Multer.File;

type PdfParseFn = (data: Buffer) => Promise<{ text: string }>;

const pdfParse = (() => {
  const mod = require("pdf-parse");
  if (typeof mod === "function") return mod as PdfParseFn;
  if (mod?.default && typeof mod.default === "function") return mod.default as PdfParseFn;
  if (mod?.pdfParse && typeof mod.pdfParse === "function") return mod.pdfParse as PdfParseFn;
  if (mod?.parse && typeof mod.parse === "function") return mod.parse as PdfParseFn;
  const fn = Object.values(mod ?? {}).find((v) => typeof v === "function");
  if (typeof fn === "function") return fn as PdfParseFn;
  throw new Error(`pdf-parse loaded but no function export found.`);
})();

export async function parseUploadedFile(file: MulterFile): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = await fs.readFile(file.path);
  await fs.unlink(file.path).catch(() => {}); // cleanup

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

export async function parseMultipleFiles(files: MulterFile[]): Promise<string> {
  const texts = await parseMultipleFilesAsArray(files);
  return texts.join("\n\n--- קובץ הבא ---\n\n");
}

export async function parseMultipleFilesAsArray(files: MulterFile[]): Promise<string[]> {
  const texts: string[] = [];

  // Process sequentially — pdf-parse has internal state that breaks under concurrent calls
  for (const file of files) {
    try {
      const text = await parseUploadedFile(file);
      if (text.trim().length > 0) texts.push(text);
      else console.warn(`[parseMultipleFilesAsArray] empty text extracted from: ${file.originalname}`);
    } catch (err) {
      console.warn(`[parseMultipleFilesAsArray] failed to parse ${file.originalname}:`, err);
      await fs.unlink(file.path).catch(() => {});
    }
  }

  if (texts.length === 0) throw new Error("לא הצלחנו לחלץ טקסט מאף קובץ.");
  return texts;
}

function cleanText(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
