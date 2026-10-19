import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Runner } from "./runner.mjs";

const app = express();
const port = process.env.PORT ?? 3001;
const runner = new Runner();

app.use(cors());
app.use(express.json());

// GET /api/latest — baca latest.json
app.get("/api/latest", async (req, res) => {
  try {
    const data = await readFile(join(process.cwd(), "..", "latest.json"), "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(404).json({ error: "latest.json belum ada" });
  }
});

// POST /api/run — jalankan QA
app.post("/api/run", (req, res) => {
  const { mode = "pw", specs = [] } = req.body;
  const result = runner.start(mode, specs);
  res.json(result);
});

// POST /api/stop — stop runner
app.post("/api/stop", (req, res) => {
  res.json(runner.stop());
});

// GET /api/status — cek status runner
app.get("/api/status", (req, res) => {
  res.json(runner.status());
});

const server = app.listen(port, () => {
  console.log(`server: http://127.0.0.1:${port}`);
});

// WebSocket — stream log
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", ...runner.status() }));

  const onLog = (line) => ws.send(JSON.stringify({ type: "log", line }));
  const onStart = (meta) => ws.send(JSON.stringify({ type: "start", ...meta }));
  const onDone = (meta) => ws.send(JSON.stringify({ type: "done", ...meta }));

  runner.on("log", onLog);
  runner.on("start", onStart);
  runner.on("done", onDone);

  ws.on("close", () => {
    runner.off("log", onLog);
    runner.off("start", onStart);
    runner.off("done", onDone);
  });
});
