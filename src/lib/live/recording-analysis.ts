import { getRelayDebugSummary, getRelayHttpBaseUrl, getRelayHttpBaseUrls } from "@/lib/live/relay-host";
import { VoiceOutputStyle } from "@/types/app-state";

const RELAY_TIMEOUTS = {
  health: 45_000,
  analysis: 22_000,
  speech: 32_000
};

function readServerError(body: string, fallback: string) {
  try {
    const data = JSON.parse(body) as { error?: string };
    return data.error || body || fallback;
  } catch {
    return body || fallback;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return globalThis.btoa(binary);
}

async function fileUriToBase64(uri: string) {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

async function fetchRelay(path: string, init?: RequestInit, timeoutMs: number = RELAY_TIMEOUTS.analysis) {
  const errors: string[] = [];

  for (const baseUrl of getRelayHttpBaseUrls()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.info("[CarTalk] Relay fetch", {
        path,
        url: `${baseUrl}${path}`,
        relay: getRelayDebugSummary()
      });
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `timeout na ${Math.round(timeoutMs / 1000)} seconden`
          : error instanceof Error
            ? error.message
            : "Onbekende netwerkfout";
      errors.push(`${baseUrl}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    errors[0] ||
      `CarTalk kon geen verbinding maken met de backend op ${getRelayHttpBaseUrl()}.`
  );
}

export type RecordingAnalysis = {
  rawText: string;
  transcript: string;
  applicable: boolean;
  reasonCategory: string;
  receiverOutput: string;
  targetDescription: string | null;
  senderReply: string;
};

export async function requestRelayHealth() {
  const response = await fetchRelay("/health", {
    method: "GET"
  }, RELAY_TIMEOUTS.health);

  if (!response.ok) {
    const text = await response.text();
    let serverError = "";

    try {
      const data = JSON.parse(text) as { error?: string };
      serverError = data.error || "";
    } catch {
      // Keep the plain response body below.
    }

    throw new Error(serverError || text || `CarTalk kon de backend niet bereiken via ${getRelayHttpBaseUrl()}/health.`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    model?: string;
    error?: string;
  };

  if (!data.ok) {
    throw new Error(data.error || "CarTalk kon de backend niet valideren.");
  }

  return data;
}

export async function requestLiveSpokenAlert(text: string, voiceStyle: VoiceOutputStyle) {
  const response = await fetchRelay("/live-speak", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text, voiceStyle })
  }, RELAY_TIMEOUTS.speech);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      readServerError(
        body,
        `Gemini-audio ophalen mislukt via ${getRelayHttpBaseUrl()}/live-speak.`
      )
    );
  }

  const data = (await response.json()) as {
    ok: boolean;
    audioBase64?: string;
    mimeType?: string;
    transcript?: string;
    error?: string;
  };

  if (!data.ok || !data.audioBase64 || !data.mimeType) {
    throw new Error(data.error || "Geen live spraak ontvangen.");
  }

  return {
    audioBase64: data.audioBase64,
    mimeType: data.mimeType,
    transcript: data.transcript || ""
  };
}

export function getLiveSpokenAlertUrl(text: string) {
  const baseUrl = getRelayHttpBaseUrl();
  return `${baseUrl}/live-speak-audio?text=${encodeURIComponent(text)}`;
}

export async function analyzeDriverTranscript(transcript: string) {
  const response = await fetchRelay("/analyze-transcript", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transcript
    })
  }, RELAY_TIMEOUTS.analysis);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(readServerError(text, "Analyseren van transcript mislukt."));
  }

  const data = (await response.json()) as {
    ok: boolean;
    analysis?: RecordingAnalysis;
    error?: string;
  };

  if (!data.ok || !data.analysis) {
    throw new Error(data.error || "Geen analyse ontvangen.");
  }

  return data.analysis;
}

export async function analyzeRecordingFromUri(uri: string, mimeType: string = "audio/mp4") {
  const audioBase64 = await fileUriToBase64(uri);
  const response = await fetchRelay("/analyze-recording", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audioBase64,
      mimeType
    })
  }, RELAY_TIMEOUTS.analysis);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(readServerError(text, "Analyseren van opname mislukt."));
  }

  const data = (await response.json()) as {
    ok: boolean;
    analysis?: RecordingAnalysis;
    error?: string;
  };

  if (!data.ok || !data.analysis) {
    throw new Error(data.error || "Geen analyse ontvangen.");
  }

  return data.analysis;
}
