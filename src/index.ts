import "dotenv/config";
import express from "express";
import cors from "cors";
import examRoutes from "./routes/examRoute";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/exam", examRoutes);

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => console.log(`Server running on :${port}`));
