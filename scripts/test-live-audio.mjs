import fs from "node:fs";
import process from "node:process";

import { WebSocket } from "ws";

const wavPath = process.argv[2];

if (!wavPath) {
  console.error("Usage: node scripts/test-live-audio.mjs /path/to/file.wav");
  process.exit(1);
}

const file = fs.readFileSync(wavPath);
if (file.length <= 44) {
  console.error("WAV file too small.");
  process.exit(1);
}

const pcmBase64 = file.subarray(44).toString("base64");
const socket = new WebSocket("ws://127.0.0.1:8787/live");
let loggedFirstPayload = false;

socket.on("open", () => {
  console.log("relay-open");
});

socket.on("message", (raw) => {
  const parsed = JSON.parse(String(raw));

  if (parsed.type === "relay_ready") {
    console.log("relay-ready", parsed.model);
    socket.send(
      JSON.stringify({
        type: "send_realtime_input",
        payload: {
          mediaChunks: [
            {
              mimeType: "audio/pcm;rate=16000",
              data: pcmBase64
            }
          ]
        }
      })
    );
    socket.send(
      JSON.stringify({
        type: "send_realtime_input",
        payload: {
          audioStreamEnd: true
        }
      })
    );
    return;
  }

  if (parsed.type === "gemini_message") {
    console.log("payload-keys", Object.keys(parsed.payload ?? {}));
    if (!loggedFirstPayload) {
      loggedFirstPayload = true;
      console.log("first-payload", JSON.stringify(parsed.payload));
    }
    const content = parsed.payload?.serverContent;
    console.log("gemini-message-keys", Object.keys(content ?? {}));
    if (content?.inputTranscription?.text) {
      console.log("input:", content.inputTranscription.text);
    }
    if (content?.outputTranscription?.text) {
      console.log("output:", content.outputTranscription.text);
    }
    if (content?.turnComplete) {
      console.log("turn-complete");
      process.exit(0);
    }
    return;
  }

  if (parsed.type === "relay_error") {
    console.error("relay-error:", parsed.message);
    process.exit(2);
  }
});

socket.on("error", (error) => {
  console.error("socket-error:", error.message);
  process.exit(3);
});
