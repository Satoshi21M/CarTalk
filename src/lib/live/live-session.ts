import { createLiveRelaySocket, getLiveRelayUrl } from "@/lib/live/live-relay-client";

export type LiveRelayEvent =
  | { type: "status"; message: string }
  | { type: "error"; message: string }
  | { type: "ready"; model: string }
  | { type: "gemini"; payload: unknown };

type Listener = (event: LiveRelayEvent) => void;

export class LiveSession {
  private socket: WebSocket | null = null;
  private listener: Listener;
  private isReady = false;

  constructor(listener: Listener) {
    this.listener = listener;
  }

  get ready() {
    return this.isReady;
  }

  connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.isReady = false;
    this.listener({ type: "status", message: "Connecting to CarTalk live relay..." });
    const socket = createLiveRelaySocket();

    socket.onopen = () => {
      this.listener({ type: "status", message: "Relay connection open." });
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data));

        if (parsed.type === "relay_ready") {
          this.isReady = true;
          this.listener({ type: "ready", model: parsed.model });
          return;
        }

        if (parsed.type === "relay_error") {
          this.listener({ type: "error", message: parsed.message });
          return;
        }

        if (parsed.type === "relay_status") {
          this.listener({ type: "status", message: parsed.message });
          return;
        }

        if (parsed.type === "gemini_message") {
          this.listener({ type: "gemini", payload: parsed.payload });
          return;
        }

        this.listener({ type: "status", message: `Unhandled relay event: ${parsed.type}` });
      } catch (error) {
        this.listener({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to parse relay message"
        });
      }
    };

    socket.onerror = () => {
      this.listener({
        type: "error",
        message: `Relay socket error op ${getLiveRelayUrl()}. Controleer of de CarTalk backend bereikbaar is.`
      });
    };

    socket.onclose = () => {
      this.isReady = false;
      this.listener({ type: "status", message: "Relay connection closed." });
    };

    this.socket = socket;
  }

  disconnect() {
    this.isReady = false;
    this.socket?.close();
    this.socket = null;
  }

  sendClientContent(text: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.isReady) {
      this.listener({ type: "error", message: "Relay is not connected yet." });
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "send_client_content",
        payload: {
          turns: [
            {
              role: "user",
              parts: [{ text }]
            }
          ],
          turnComplete: true
        }
      })
    );
  }

  sendRealtimeAudioChunk(base64Pcm: string, mimeType: string = "audio/pcm;rate=16000") {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.isReady) {
      this.listener({ type: "error", message: "Relay is not connected yet." });
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "send_realtime_input",
        payload: {
          mediaChunks: [
            {
              mimeType,
              data: base64Pcm
            }
          ]
        }
      })
    );
  }

  sendRealtimeAudioEnd() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.isReady) {
      this.listener({ type: "error", message: "Relay is not connected yet." });
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "send_realtime_input",
        payload: {
          audioStreamEnd: true
        }
      })
    );
  }
}
