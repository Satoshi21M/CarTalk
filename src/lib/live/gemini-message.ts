type InlineData = {
  mimeType?: string;
  data?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: InlineData;
};

type GeminiPayload = {
  setupComplete?: Record<string, unknown>;
  voiceActivity?: {
    voiceActivityType?: string;
  };
  voiceActivityDetectionSignal?: {
    vadSignalType?: string;
  };
  serverContent?: {
    turnComplete?: boolean;
    waitingForInput?: boolean;
    turnCompleteReason?: string;
    audioChunks?: InlineData[];
    inputTranscription?: {
      text?: string;
    };
    outputTranscription?: {
      text?: string;
    };
    modelTurn?: {
      parts?: GeminiPart[];
    };
  };
};

export function extractGeminiText(payload: unknown) {
  const typed = payload as GeminiPayload;
  const parts = typed.serverContent?.modelTurn?.parts ?? [];

  return parts
    .map((part) => part.text)
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function extractGeminiAudioChunks(payload: unknown) {
  const typed = payload as GeminiPayload;
  const directChunks = typed.serverContent?.audioChunks ?? [];
  const parts = typed.serverContent?.modelTurn?.parts ?? [];

  const partChunks = parts
    .map((part) => part.inlineData)
    .filter((value): value is InlineData => Boolean(value?.data && value?.mimeType))
    .filter((value) => value.mimeType?.startsWith("audio/pcm"));

  const streamedChunks = directChunks
    .filter((value): value is InlineData => Boolean(value?.data && value?.mimeType))
    .filter((value) => value.mimeType?.startsWith("audio/pcm"));

  return [...streamedChunks, ...partChunks];
}

export function isGeminiTurnComplete(payload: unknown) {
  const typed = payload as GeminiPayload;
  return Boolean(typed.serverContent?.turnComplete);
}

export function extractGeminiOutputTranscription(payload: unknown) {
  const typed = payload as GeminiPayload;
  return typed.serverContent?.outputTranscription?.text || "";
}

export function extractGeminiInputTranscription(payload: unknown) {
  const typed = payload as GeminiPayload;
  return typed.serverContent?.inputTranscription?.text || "";
}

export function extractGeminiVoiceActivityType(payload: unknown) {
  const typed = payload as GeminiPayload;
  return typed.voiceActivity?.voiceActivityType || typed.voiceActivityDetectionSignal?.vadSignalType || "";
}
