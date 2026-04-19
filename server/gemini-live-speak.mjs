import { Buffer } from "node:buffer";

import { GoogleGenAI } from "@google/genai";

import { assertGeminiServerConfig, getServerConfig } from "./config.mjs";

const VOICE_STYLE_PROFILES = {
  seductive: {
    primary: "Use a warm, charming, confident, smooth tone. Keep it elegant and subtle, never cheesy.",
    soft: "Use a warm, calm, lightly charming tone. Keep it smooth and understated."
  },
  reggae: {
    primary: "Use a laid-back, friendly, lightly rhythmic reggae-radio-host energy. Keep it relaxed, calm, and easygoing.",
    soft: "Use a laid-back, friendly, calm tone with just a hint of easygoing rhythm."
  },
  showman: {
    primary: "Use a bold, confident, theatrical showman energy. Keep it fun and punchy, but still short and road-appropriate.",
    soft: "Use a confident, upbeat, slightly theatrical tone while staying controlled and concise."
  },
  schoolmaster: {
    primary: "Use a neutral, professional, clear, lightly corrective teacher-like tone. Stay calm and respectful.",
    soft: "Use a neutral, calm, professional tone. Stay brief and respectful."
  }
};

function appendAudioChunk(audioChunks, chunk) {
  if (!chunk?.data || !chunk?.mimeType?.startsWith("audio/")) {
    return;
  }

  audioChunks.push({
    mimeType: chunk.mimeType,
    data: chunk.data
  });
}

function buildWavHeader(dataLength, sampleRate, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function parseSampleRate(mimeType = "") {
  const match = mimeType.match(/rate=(\d+)/i);
  const parsed = match ? Number.parseInt(match[1] || "", 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 24_000;
}

const WAV_HEADER_SIZE = 44;
const IOS_FRIENDLY_SAMPLE_RATE = 48_000;

function stripWavHeaderIfPresent(buf) {
  // WAV files start with "RIFF". If present, strip the 44-byte header to get raw PCM.
  if (buf.length > WAV_HEADER_SIZE && buf.slice(0, 4).toString("ascii") === "RIFF") {
    return buf.slice(WAV_HEADER_SIZE);
  }
  return buf;
}

function resampleMonoPcm16(rawPcmBytes, inputSampleRate, outputSampleRate) {
  if (!rawPcmBytes.length || !Number.isFinite(inputSampleRate) || !Number.isFinite(outputSampleRate)) {
    return rawPcmBytes;
  }

  if (inputSampleRate <= 0 || outputSampleRate <= 0 || inputSampleRate === outputSampleRate) {
    return rawPcmBytes;
  }

  const inputSampleCount = Math.floor(rawPcmBytes.length / 2);
  if (inputSampleCount <= 1) {
    return rawPcmBytes;
  }

  const outputSampleCount = Math.max(1, Math.round((inputSampleCount * outputSampleRate) / inputSampleRate));
  const output = Buffer.alloc(outputSampleCount * 2);

  for (let outputIndex = 0; outputIndex < outputSampleCount; outputIndex += 1) {
    const sourcePosition = (outputIndex * inputSampleRate) / outputSampleRate;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, inputSampleCount - 1);
    const mix = sourcePosition - leftIndex;
    const leftSample = rawPcmBytes.readInt16LE(leftIndex * 2);
    const rightSample = rawPcmBytes.readInt16LE(rightIndex * 2);
    const interpolated = Math.round(leftSample + (rightSample - leftSample) * mix);
    output.writeInt16LE(interpolated, outputIndex * 2);
  }

  return output;
}

function buildWavBase64(audioChunks) {
  if (!audioChunks.length) {
    return {
      audioBase64: "",
      mimeType: "audio/wav"
    };
  }

  const sampleRate = parseSampleRate(audioChunks[0]?.mimeType);

  // Decode every chunk individually and strip any WAV headers before concatenating.
  // This handles mixed chunks where some are WAV-wrapped and some are raw PCM.
  const pcmBuffers = audioChunks.map((chunk) => stripWavHeaderIfPresent(Buffer.from(chunk.data, "base64")));
  const pcmBytes = Buffer.concat(pcmBuffers);
  const outputSampleRate = PlatformSafeSampleRate(sampleRate);
  const normalizedPcmBytes = resampleMonoPcm16(pcmBytes, sampleRate, outputSampleRate);
  const header = buildWavHeader(normalizedPcmBytes.length, outputSampleRate);
  const wavBytes = Buffer.concat([header, normalizedPcmBytes]);

  return {
    audioBase64: wavBytes.toString("base64"),
    mimeType: "audio/wav"
  };
}

function PlatformSafeSampleRate(sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return IOS_FRIENDLY_SAMPLE_RATE;
  }

  if (sampleRate === IOS_FRIENDLY_SAMPLE_RATE) {
    return sampleRate;
  }

  return IOS_FRIENDLY_SAMPLE_RATE;
}

function normalizeVoiceStyle(style) {
  return Object.hasOwn(VOICE_STYLE_PROFILES, style) ? style : "schoolmaster";
}

function getSpeakStyleAttempts(style) {
  const normalizedStyle = normalizeVoiceStyle(style);
  const selectedProfile = VOICE_STYLE_PROFILES[normalizedStyle];

  if (normalizedStyle === "schoolmaster") {
    return [selectedProfile.primary];
  }

  return [selectedProfile.primary, selectedProfile.soft, VOICE_STYLE_PROFILES.schoolmaster.primary];
}

function buildSpeakInstruction(prompt, styleInstruction) {
  return [
    "You are CarTalk, a voice-first assistant for drivers.",
    "Speak naturally, clearly, briefly, and in the same language as the provided text when appropriate.",
    styleInstruction,
    "Do not add extra explanation beyond the intended spoken message.",
    `TEXT_TO_SPEAK: ${prompt}`
  ].join("\n");
}

function shouldContinueVoiceFallback(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("geen audio") ||
    message.includes("timed out") ||
    message.includes("closed before audio") ||
    message.includes("no audio")
  );
}

function shouldRetryLiveSpeakError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("\"status\":\"unavailable\"") ||
    message.includes("\"code\":503") ||
    message.includes("resource_exhausted") ||
    message.includes("\"code\":429") ||
    message.includes("rate limit")
  );
}

async function runGeminiLiveSpeakOnce(prompt, styleInstruction) {
  const requiredConfig = assertGeminiServerConfig();
  const config = getServerConfig();
  const ai = new GoogleGenAI({ apiKey: requiredConfig.geminiApiKey });

  const audioChunks = [];
  const transcriptParts = [];
  let session = null;

  const result = await new Promise(async (resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    const timeout = setTimeout(() => {
      settle(reject, new Error("Gemini live speak timed out before returning audio."));
    }, 12_000);

    try {
      session = await ai.live.connect({
        model: config.geminiLiveModel,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: [
            "You are CarTalk.",
            "Reply in concise spoken audio for drivers.",
            "Follow the requested delivery style while keeping the message short, clear, and traffic-appropriate."
          ].join("\n"),
          outputAudioTranscription: {}
        },
        callbacks: {
          onmessage: (message) => {
            const serverContent = message?.serverContent;
            if (!serverContent) {
              return;
            }

            if (serverContent.outputTranscription?.text) {
              transcriptParts.push(serverContent.outputTranscription.text);
            }

            const directChunks = Array.isArray(serverContent.audioChunks) ? serverContent.audioChunks : [];
            for (const chunk of directChunks) {
              appendAudioChunk(audioChunks, chunk);
            }

            const parts = Array.isArray(serverContent.modelTurn?.parts) ? serverContent.modelTurn.parts : [];
            for (const part of parts) {
              if (part?.text) {
                transcriptParts.push(part.text);
              }
              appendAudioChunk(audioChunks, part?.inlineData);
            }

            if (serverContent.turnComplete || serverContent.generationComplete) {
              clearTimeout(timeout);
              const audio = buildWavBase64(audioChunks);
              if (!audio.audioBase64) {
                settle(reject, new Error("Gemini live route gaf geen audio terug."));
                return;
              }

              settle(resolve, {
                ok: true,
                ...audio,
                transcript: transcriptParts.join(" ").replace(/\s+/g, " ").trim(),
                model: config.geminiLiveModel
              });
            }
          },
          onerror: (error) => {
            clearTimeout(timeout);
            settle(reject, error instanceof Error ? error : new Error("Unknown Gemini live speak error"));
          },
          onclose: () => {
            if (!settled) {
              clearTimeout(timeout);
              if (audioChunks.length > 0) {
                const audio = buildWavBase64(audioChunks);
                settle(resolve, {
                  ok: true,
                  ...audio,
                  transcript: transcriptParts.join(" ").replace(/\s+/g, " ").trim(),
                  model: config.geminiLiveModel
                });
                return;
              }
              settle(reject, new Error("Gemini live speak session closed before audio was returned."));
            }
          }
        }
      });

      session.sendRealtimeInput({
        text: buildSpeakInstruction(prompt, styleInstruction)
      });
    } catch (error) {
      clearTimeout(timeout);
      settle(reject, error instanceof Error ? error : new Error("Failed to start Gemini live speak"));
    }
  });

  try {
    return result;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch {
        // Ignore close errors after the reply has already completed.
      }
    }
  }
}

export async function runGeminiLiveSpeak(prompt, voiceStyle = "schoolmaster") {
  let lastError = null;

  for (let retryAttempt = 0; retryAttempt < 3; retryAttempt += 1) {
    for (const styleInstruction of getSpeakStyleAttempts(voiceStyle)) {
      try {
        return await runGeminiLiveSpeakOnce(prompt, styleInstruction);
      } catch (error) {
        lastError = error;
        if (!shouldContinueVoiceFallback(error)) {
          if (!shouldRetryLiveSpeakError(error) || retryAttempt === 2) {
            throw error;
          }
          break;
        }
      }
    }

    if (retryAttempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 700 + retryAttempt * 500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini live speak failed.");
}
