import { ActivityHandling, EndSensitivity, GoogleGenAI, StartSensitivity } from "@google/genai";

import { assertGeminiServerConfig } from "./config.mjs";

function toPlainPart(part) {
  return {
    text: part?.text,
    inlineData: part?.inlineData
      ? {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data
        }
      : undefined
  };
}

function toPlainMessage(message) {
  return {
    setupComplete: message?.setupComplete ? {} : undefined,
    serverContent: message?.serverContent
      ? {
          turnComplete: Boolean(message.serverContent.turnComplete),
          waitingForInput: Boolean(message.serverContent.waitingForInput),
          turnCompleteReason: message.serverContent.turnCompleteReason,
          inputTranscription: message.serverContent.inputTranscription
            ? {
                text: message.serverContent.inputTranscription.text
              }
            : undefined,
          outputTranscription: message.serverContent.outputTranscription
            ? {
                text: message.serverContent.outputTranscription.text
              }
            : undefined,
          audioChunks: Array.isArray(message.serverContent.audioChunks)
            ? message.serverContent.audioChunks.map((chunk) => ({
                mimeType: chunk?.mimeType,
                data: chunk?.data
              }))
            : undefined,
          modelTurn: message.serverContent.modelTurn
            ? {
                parts: Array.isArray(message.serverContent.modelTurn.parts)
                  ? message.serverContent.modelTurn.parts.map(toPlainPart)
                  : []
              }
            : undefined
        }
      : undefined
    ,
    voiceActivity: message?.voiceActivity
      ? {
          voiceActivityType: message.voiceActivity.voiceActivityType
        }
      : undefined,
    voiceActivityDetectionSignal: message?.voiceActivityDetectionSignal
      ? {
          vadSignalType: message.voiceActivityDetectionSignal.vadSignalType
        }
      : undefined
  };
}

function normalizeClientMessage(raw) {
  const parsed = JSON.parse(raw.toString());

  if (parsed.type === "send_client_content") {
    return { clientContent: parsed.payload };
  }

  if (parsed.type === "send_realtime_input") {
    return { realtimeInput: parsed.payload };
  }

  if (parsed.type === "tool_response") {
    return { toolResponse: parsed.payload };
  }

  throw new Error(`Unsupported client relay message type: ${parsed.type}`);
}

export async function attachGeminiRelay(browserSocket) {
  const config = assertGeminiServerConfig();
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const session = await ai.live.connect({
    model: config.geminiLiveModel,
    config: {
      responseModalities: ["TEXT"],
      systemInstruction: [
        "You are the CarTalk live input relay.",
        "Do not generate assistant replies.",
        "Only support accurate input transcription and voice activity handling for the driver."
      ].join("\n"),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        activityHandling: ActivityHandling.NO_INTERRUPTION,
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 120,
          silenceDurationMs: 650,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH
        }
      }
    },
    callbacks: {
      onmessage: (message) => {
        browserSocket.send(
          JSON.stringify({
            type: "gemini_message",
            payload: toPlainMessage(message)
          })
        );
      },
      onerror: (error) => {
        browserSocket.send(
          JSON.stringify({
            type: "relay_error",
            message: error?.message || "Unknown Gemini relay error"
          })
        );
      },
      onclose: () => {
        browserSocket.send(
          JSON.stringify({
            type: "relay_status",
            message: "Gemini live session closed."
          })
        );
      }
    }
  });

  browserSocket.send(
    JSON.stringify({
      type: "relay_ready",
      model: config.geminiLiveModel
    })
  );

  browserSocket.on("message", async (raw) => {
    try {
      const message = normalizeClientMessage(raw);

      if (message.clientContent) {
        session.sendClientContent(message.clientContent);
        return;
      }

      if (message.realtimeInput) {
        session.sendRealtimeInput(message.realtimeInput);
        return;
      }

      if (message.toolResponse) {
        session.sendToolResponse(message.toolResponse);
      }
    } catch (error) {
      browserSocket.send(
        JSON.stringify({
          type: "relay_error",
          message: error instanceof Error ? error.message : "Unknown client relay error"
        })
      );
    }
  });

  browserSocket.on("close", async () => {
    await session.close();
  });
}
