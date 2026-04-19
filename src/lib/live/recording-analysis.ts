import { getRelayDebugSummary, getRelayHttpBaseUrl, getRelayHttpBaseUrls } from "@/lib/live/relay-host";
import { VoiceOutputStyle } from "@/types/app-state";

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

async function fetchRelay(path: string, init?: RequestInit) {
  const errors: string[] = [];

  for (const baseUrl of getRelayHttpBaseUrls()) {
    try {
      console.info("[CarTalk] Relay fetch", {
        path,
        url: `${baseUrl}${path}`,
        relay: getRelayDebugSummary()
      });
      return await fetch(`${baseUrl}${path}`, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onbekende netwerkfout";
      errors.push(`${baseUrl}: ${message}`);
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
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const data = JSON.parse(text) as { error?: string };
      throw new Error(
        data.error ||
          `CarTalk kon de lokale relay-server niet bereiken via ${getRelayHttpBaseUrl()}/health.`
        
      );
    } catch {
      throw new Error(text || `CarTalk kon de backend niet bereiken via ${getRelayHttpBaseUrl()}/health.`);
    }
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
  });

  if (!response.ok) {
    const body = await response.text();

    try {
      const data = JSON.parse(body) as { error?: string };
      throw new Error(
        data.error ||
          `Gemini-audio ophalen mislukt via ${getRelayHttpBaseUrl()}/live-speak.`
      );
    } catch {
      throw new Error(body || `Gemini-audio ophalen mislukt via ${getRelayHttpBaseUrl()}/live-speak.`);
    }
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
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const data = JSON.parse(text) as { error?: string };
      throw new Error(data.error || "Analyseren van transcript mislukt.");
    } catch {
      throw new Error(text || "Analyseren van transcript mislukt.");
    }
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
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const data = JSON.parse(text) as { error?: string };
      throw new Error(data.error || "Analyseren van opname mislukt.");
    } catch {
      throw new Error(text || "Analyseren van opname mislukt.");
    }
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
