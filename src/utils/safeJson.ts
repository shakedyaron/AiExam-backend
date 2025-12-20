export function safeJsonParse<T>(raw: string): T {
  const s = (raw ?? "").trim();

  // 1) אם חזר עטוף בקוד בלוק
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? s).trim();

  // 2) ניסיון parse ישיר
  try {
    return JSON.parse(candidate) as T;
  } catch {}

  // 3) ניסיון "לחלץ" בין { ... } במקרה שיש טקסט מסביב
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = candidate.slice(first, last + 1);
    return JSON.parse(sliced) as T;
  }

  throw new Error("Model returned non-JSON response");
}
