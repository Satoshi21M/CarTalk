import http from "node:http";

import express from "express";
import { WebSocketServer } from "ws";

import { getServerConfig } from "./config.mjs";
import { createDemoNetworkStore } from "./demo-network.mjs";
import { analyzeDriverTranscript, analyzeRecordedAudio } from "./gemini-audio-analyze.mjs";
import { attachGeminiRelay } from "./gemini-live-relay.mjs";
import { runGeminiLiveSpeak } from "./gemini-live-speak.mjs";

const app = express();
const server = http.createServer(app);
const config = getServerConfig();
const listenHost = "0.0.0.0";
const demoNetwork = createDemoNetworkStore();
const liveInputRelayEnabled = process.env.ENABLE_LIVE_INPUT_RELAY === "true";
const wsServer = liveInputRelayEnabled
  ? new WebSocketServer({ server, path: "/live" })
  : null;
const geminiRateWindows = new Map();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function limitGeminiRequests(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const window = geminiRateWindows.get(key);
  const current =
    !window || now - window.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : window;

  current.count += 1;
  geminiRateWindows.set(key, current);
  if (current.count > 30) {
    res.status(429).json({
      ok: false,
      error: "Too many Gemini requests. Try again shortly."
    });
    return;
  }

  if (geminiRateWindows.size > 1_000) {
    for (const [windowKey, entry] of geminiRateWindows) {
      if (now - entry.startedAt >= 60_000) {
        geminiRateWindows.delete(windowKey);
      }
    }
  }
  next();
}

app.use(
  ["/analyze-recording", "/analyze-transcript", "/live-speak", "/live-speak-audio"],
  limitGeminiRequests
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cartalk-live-relay",
    port: config.port,
    model: config.geminiLiveModel,
    analysisModel: config.geminiAnalysisModel,
    analysisMode: config.geminiAnalysisMode,
    liveInputRelayEnabled,
    activeDemoDevices: demoNetwork.getPresenceCount()
  });
});

app.post("/presence", (req, res) => {
  try {
    const presence = demoNetwork.setPresence(req.body ?? {});
    res.json({ ok: true, presence });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid presence"
    });
  }
});

app.post("/presence/offline", (req, res) => {
  demoNetwork.clearPresence(req.body?.userId);
  res.json({ ok: true });
});

app.post("/resolve-recipient", (req, res) => {
  const recipient = demoNetwork.resolveRecipient(req.body ?? {});
  res.json({ ok: true, recipient });
});

app.post("/deliver", (req, res) => {
  const delivery = demoNetwork.sendDelivery(req.body ?? {});
  if (!delivery) {
    res.status(409).json({ ok: false, error: "Recipient is not online" });
    return;
  }
  res.json({ ok: true, deliveryId: delivery.id });
});

app.get("/deliveries", (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : "";
  if (!userId) {
    res.status(400).json({ ok: false, error: "Missing userId" });
    return;
  }
  res.json({ ok: true, deliveries: demoNetwork.listDeliveries(userId) });
});

app.post("/deliveries/ack", (req, res) => {
  const { userId, deliveryId } = req.body ?? {};
  if (!userId || !deliveryId) {
    res.status(400).json({ ok: false, error: "Missing userId or deliveryId" });
    return;
  }
  demoNetwork.acknowledgeDelivery(userId, deliveryId);
  res.json({ ok: true });
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

wsServer?.on("connection", (socket) => {
  void attachGeminiRelay(socket);
});

server.listen(config.port, listenHost, () => {
  console.log(`CarTalk Gemini relay listening on http://localhost:${config.port}`);
  console.log(`CarTalk Gemini relay listening on http://${listenHost}:${config.port}`);
});
