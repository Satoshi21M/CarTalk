import { IOSOutputFormat, AudioQuality, type RecordingOptions } from "expo-audio";

import { stripWavHeaderToBase64 } from "./native-audio";

/**
 * Recording options for 16 kHz linear PCM — what Gemini Live requires.
 *
 * iOS: IOSOutputFormat.LINEARPCM produces a WAV-wrapped PCM file.
 *      stripWavHeaderToBase64() removes the 44-byte header before sending.
 *
 * Android: expo-audio does not expose a raw PCM output format.
 *          'default' encoder is used as a best-effort fallback.
 *          TODO: investigate using expo-audio-stream for Android PCM streaming.
 */
export const PCM_16K_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    extension: ".wav",
    outputFormat: "default",
    audioEncoder: "default",
    sampleRate: 16000
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.MIN,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false
  },
  web: {}
};

/** Gemini Live expects this MIME type for 16 kHz 16-bit mono PCM. */
export const GEMINI_PCM_MIME_TYPE = "audio/pcm;rate=16000";

type SegmentProvider = {
  /** Start a fresh recording segment. */
  startSegment: () => Promise<void>;
  /** Stop the current segment and return its local URI, or null on failure. */
  stopSegment: () => Promise<string | null>;
};

/**
 * Streams microphone audio to a Gemini Live session by recording short
 * consecutive segments and sending the raw PCM bytes.
 *
 * Gemini Live's built-in VAD will detect the end of the utterance and
 * emit turnComplete — no silence timer needed on our side.
 *
 * Usage:
 *   const streamer = new NativeMicStreamer(segmentProvider, (chunk, mime) => {
 *     liveSession.sendRealtimeAudioChunk(chunk, mime);
 *   });
 *   streamer.start();
 *   // ... later, when Gemini fires turnComplete:
 *   streamer.stop();
 */
export class NativeMicStreamer {
  private running = false;
  private loopHandle: ReturnType<typeof setTimeout> | null = null;
  private currentSegmentStop: Promise<void> | null = null;

  constructor(
    private readonly segments: SegmentProvider,
    private readonly onChunk: (base64Pcm: string, mimeType: string) => void,
    private readonly segmentMs = 300
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    if (this.currentSegmentStop) {
      await this.currentSegmentStop;
      return;
    }

    try {
      await this.segments.stopSegment();
    } catch {
      // Ignore stop failures while shutting down the live mic.
    }
  }

  private async loop(): Promise<void> {
    if (!this.running) return;

    try {
      await this.segments.startSegment();
    } catch {
      // If we can't start a segment, bail out
      this.running = false;
      return;
    }

    this.loopHandle = setTimeout(async () => {
      if (!this.running) return;

      let uri: string | null = null;
      this.currentSegmentStop = (async () => {
        try {
          uri = await this.segments.stopSegment();
        } catch {
          // Segment read failed — keep going
        }
      })();

      await this.currentSegmentStop;
      this.currentSegmentStop = null;

      if (uri && this.running) {
        try {
          const response = await fetch(uri);
          const buffer = await response.arrayBuffer();
          const base64Pcm = stripWavHeaderToBase64(buffer);
          if (base64Pcm) {
            this.onChunk(base64Pcm, GEMINI_PCM_MIME_TYPE);
          }
        } catch {
          // Fetch/encode failed — skip this chunk, continue streaming
        }
      }

      // Schedule the next segment immediately
      void this.loop();
    }, this.segmentMs);
  }
}
