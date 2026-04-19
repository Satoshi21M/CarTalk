import http from "node:http";

import express from "express";
import { WebSocketServer } from "ws";

import { getServerConfig } from "./config.mjs";
import { analyzeDriverTranscript, analyzeRecordedAudio } from "./gemini-audio-analyze.mjs";
import { attachGeminiRelay } from "./gemini-live-relay.mjs";
import { runGeminiLiveSpeak } from "./gemini-live-speak.mjs";

const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ server, path: "/live" });
const config = getServerConfig();
const listenHost = "0.0.0.0";

app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cartalk-live-relay",
    port: config.port,
    model: config.geminiLiveModel
  });
});

app.post("/analyze-recording", async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body ?? {};

    if (!audioBase64 || typeof audioBase64 !== "string") {
      res.status(400).json({ ok: false, error: "Missing audioBase64" });
      return;
    }

    const analysis = await analyzeRecordedAudio({
      audioBase64,
      mimeType: typeof mimeType === "string" ? mimeType : "audio/mp4"
    });

    res.json({
      ok: true,
      analysis
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown analysis error"
    });
  }
});

app.post("/analyze-transcript", async (req, res) => {
  try {
    const { transcript } = req.body ?? {};

    if (!transcript || typeof transcript !== "string") {
      res.status(400).json({ ok: false, error: "Missing transcript" });
      return;
    }

    const analysis = await analyzeDriverTranscript({
      transcript
    });

    res.json({
      ok: true,
      analysis
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown transcript analysis error"
    });
  }
});

app.post("/live-speak", async (req, res) => {
  try {
    const { text, voiceStyle } = req.body ?? {};

    if (!text || typeof text !== "string") {
      res.status(400).json({ ok: false, error: "Missing text" });
      return;
    }

    const result = await runGeminiLiveSpeak(text, typeof voiceStyle === "string" ? voiceStyle : "schoolmaster");
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown live speak error"
    });
  }
});

app.get("/live-speak-audio", async (req, res) => {
  try {
    const text = typeof req.query.text === "string" ? req.query.text : "";

    if (!text) {
      res.status(400).json({ ok: false, error: "Missing text" });
      return;
    }

    const result = await runGeminiLiveSpeak(text);
    if (!result?.ok || !result?.audioBase64) {
      res.status(500).json({ ok: false, error: "No live audio generated" });
      return;
    }

    res.setHeader("Content-Type", result.mimeType || "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(result.audioBase64, "base64"));
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown live speak audio error"
    });
  }
});

wsServer.on("connection", (socket) => {
  void attachGeminiRelay(socket);
});

server.listen(config.port, listenHost, () => {
  console.log(`CarTalk Gemini relay listening on http://localhost:${config.port}`);
  console.log(`CarTalk Gemini relay listening on http://${listenHost}:${config.port}`);
});
