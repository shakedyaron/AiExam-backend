import "dotenv/config";
import express from "express";
import cors from "cors";
import examRoutes from "./routes/examRoute";

// Fail fast if critical env vars are missing
const REQUIRED_ENV = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = express();

// CORS: driven by CORS_ORIGIN env var (comma-separated list of allowed origins)
// In dev, falls back to allowing all origins when CORS_ORIGIN is not set
const rawOrigins = process.env.CORS_ORIGIN;
app.use(
  cors(
    rawOrigins
      ? {
          origin: rawOrigins.split(",").map((o) => o.trim()),
          credentials: true,
        }
      : undefined,
  ),
);

app.use(express.json({ limit: "2mb" }));

app.use("/api/exam", examRoutes);

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => console.log(`Server running on :${port}`));
