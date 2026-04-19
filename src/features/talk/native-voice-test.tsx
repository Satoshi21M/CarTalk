import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Text, View } from "react-native";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system";
import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayerStatus,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState
} from "expo-audio";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from "expo-speech-recognition";

import {
  analyzeDriverTranscript,
  analyzeRecordingFromUri,
  RecordingAnalysis,
  requestRelayHealth,
  requestLiveSpokenAlert
} from "@/lib/live/recording-analysis";
import {
  extractGeminiInputTranscription,
  extractGeminiVoiceActivityType,
  isGeminiTurnComplete
} from "@/lib/live/gemini-message";
import { LiveSession } from "@/lib/live/live-session";
import { DrivingLocationService } from "@/lib/location/location-service";
import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";
import { sendLiveDelivery } from "@/lib/firebase/realtime-db";
import { describeVehicleProfile } from "@/lib/vehicles/describe-vehicle";

import {
  buildDeliveryConfirmationReply,
  buildSpokenSenderReply,
  resolveRecipientForAnalysis,
  shouldShowSentSuccess
} from "./recipient-resolution";
import { VoiceDock } from "./voice-dock";

type NativeVoiceTestProps = {
  active: boolean;
  mode?: "setup" | "main";
  onActivateDrivingMode: () => void;
};

type MainPhase = "wake" | "listening" | "finalizing" | "processing" | "replying" | "success" | "failed";
type FinalizeReason = "submit" | "silence" | "speech_timeout" | "recognizer_end" | "relay_vad_end";
type AudioModeState = "listening" | "playback" | null;

const WAKE_PHRASES = ["hey cartalk", "he cartalk", "hey car talk", "hé cartalk", "hee cartalk"];
const WAKE_GREETING_VARIANTS = ["hey", "he", "hee", "hi", "hoi", "hae"];
const WAKE_CARTALK_VARIANTS = [
  "cartalk",
  "cartalk",
  "car talk",
  "cartok",
  "cartak",
  "kartalk",
  "kartak",
  "kartok"
];
const STOP_PHRASES = [
  "stop",
  "stop cartalk",
  "stop car talk",
  "cartalk stop",
  "hou op",
  "hou maar op",
  "stop luisteren",
  "stop met luisteren",
  "annuleer",
  "annuleren",
  "cancel",
  "cancel it",
  "klaar cartalk",
  "dank je cartalk",
  "laat maar",
  "stop nu",
  "stop maar"
];
const SUBMIT_PHRASES = [
  "verstuur",
  "versturen",
  "stuur door",
  "stuur bericht",
  "stuur het bericht",
  "stuur maar door",
  "verzend",
  "verzenden",
  "verzend maar",
  "verzend het",
  "send",
  "send it",
  "send message",
  "send the message",
  "dat was het",
  "einde bericht",
  "bericht klaar",
  "klaar",
  "dat is alles"
];
const COMMAND_SILENCE_TIMEOUT_MS = 4200;
const ANALYSIS_TIMEOUT_MS = 14000;
const RECIPIENT_RESOLUTION_TIMEOUT_MS = 2200;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

function normalizeSpeech(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSpeech(text: string) {
  return normalizeSpeech(text).replace(/\s+/g, "");
}

function includesWakePhrase(text: string) {
  const normalized = normalizeSpeech(text);
  const compact = compactSpeech(text);

  if (WAKE_PHRASES.some((phrase) => normalized.includes(normalizeSpeech(phrase)))) {
    return true;
  }

  if (
    WAKE_GREETING_VARIANTS.some((greeting) => compact.includes(greeting)) &&
    WAKE_CARTALK_VARIANTS.some((variant) => compact.includes(compactSpeech(variant)))
  ) {
    return true;
  }

  return (
    ((normalized.includes("hey") || normalized.includes("he") || normalized.includes("hé")) &&
      (normalized.includes("cartalk") || normalized.includes("car talk")))
  );
}

function stripWakePhrase(text: string) {
  let next = normalizeSpeech(text);

  for (const phrase of WAKE_PHRASES) {
    next = next.replace(normalizeSpeech(phrase), " ");
  }

  for (const greeting of WAKE_GREETING_VARIANTS) {
    for (const variant of WAKE_CARTALK_VARIANTS) {
      next = next.replace(new RegExp(`\\b${greeting}\\s+${normalizeSpeech(variant)}\\b`, "g"), " ");
    }
  }

  return next.replace(/\s+/g, " ").trim();
}

function isStopCommand(text: string) {
  const normalized = normalizeSpeech(text);
  const tail = normalized.split(" ").slice(-6).join(" ");
  if (
    STOP_PHRASES.some(
      (phrase) =>
        normalized === phrase ||
        normalized.endsWith(` ${phrase}`) ||
        tail === phrase ||
        tail.endsWith(phrase) ||
        tail.includes(phrase)
    )
  ) {
    return true;
  }

  const tailTokens = tail.split(" ").filter(Boolean);
  const hasStopWord = tailTokens.some((token) => ["stop", "annuleer", "annuleren", "cancel"].includes(token));
  const mentionsCarTalk = tail.includes("cartalk") || tail.includes("car talk");
  return hasStopWord && (mentionsCarTalk || tailTokens.length <= 3);
}

function includesSubmitCommand(text: string) {
  const normalized = normalizeSpeech(text);
  const tail = normalized.split(" ").slice(-8).join(" ");

  if (
    SUBMIT_PHRASES.some(
      (phrase) =>
        normalized === phrase ||
        normalized.endsWith(` ${phrase}`) ||
        tail === phrase ||
        tail.endsWith(phrase) ||
        tail.includes(phrase)
    )
  ) {
    return true;
  }

  const tailTokens = tail.split(" ").filter(Boolean);
  const hasSendWord = tailTokens.some((token) =>
    ["verstuur", "versturen", "verzend", "verzenden", "stuur", "send"].includes(token)
  );
  return hasSendWord && tailTokens.length <= 5;
}

function stripSubmitCommand(text: string) {
  let next = normalizeSpeech(text);

  for (const phrase of SUBMIT_PHRASES) {
    if (next === phrase) {
      return "";
    }
    next = next.replace(new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b$`, "i"), "").trim();
  }

  if (/\b(send|verstuur|verzend|stuur)\b$/i.test(next)) {
    next = next.replace(/\b(send|verstuur|verzend|stuur)\b$/i, "").trim();
  }

  return next.trim();
}

function mergeTranscriptSnapshot(current: string, incoming: string) {
  const currentTrimmed = current.trim();
  const incomingTrimmed = incoming.trim();

  if (!currentTrimmed) {
    return incomingTrimmed;
  }

  if (!incomingTrimmed) {
    return currentTrimmed;
  }

  const currentNormalized = normalizeSpeech(currentTrimmed);
  const incomingNormalized = normalizeSpeech(incomingTrimmed);

  if (!currentNormalized) {
    return incomingTrimmed;
  }

  if (!incomingNormalized) {
    return currentTrimmed;
  }

  if (currentNormalized === incomingNormalized) {
    return incomingTrimmed.length >= currentTrimmed.length ? incomingTrimmed : currentTrimmed;
  }

  if (incomingNormalized.includes(currentNormalized) || incomingNormalized.endsWith(currentNormalized)) {
    return incomingTrimmed;
  }

  if (currentNormalized.includes(incomingNormalized) || currentNormalized.endsWith(incomingNormalized)) {
    return currentTrimmed;
  }

  return `${currentTrimmed} ${incomingTrimmed}`.trim();
}

function extractBestTranscript(results: Array<{ transcript?: string }> | undefined) {
  if (!Array.isArray(results) || results.length === 0) {
    return "";
  }

  const merged = results
    .map((result) => result?.transcript?.trim() || "")
    .filter(Boolean)
    .join(" ")
    .trim();

  const latest = results[results.length - 1]?.transcript?.trim() || "";

  return latest.length >= merged.length * 0.6 ? latest : merged;
}

export function NativeVoiceTest({ active, mode = "main", onActivateDrivingMode }: NativeVoiceTestProps) {
  const { state, pendingInboundDeliveries, acknowledgeInboundDelivery } = useAppState();
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [analysis, setAnalysis] = useState<RecordingAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeliveringResponse, setIsDeliveringResponse] = useState(false);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [mainPhase, setMainPhase] = useState<MainPhase>("wake");
  const [speechLevel, setSpeechLevel] = useState(-60);
  const [isRecognitionRunning, setIsRecognitionRunning] = useState(false);
  const [listeningDotCount, setListeningDotCount] = useState(1);
  const listeningStatusOpacity = useRef(new Animated.Value(0.75)).current;
  const listeningStatusTranslateY = useRef(new Animated.Value(2)).current;
  const commandTranscriptRef = useRef("");
  const wakeTranscriptBufferRef = useRef<string[]>([]);
  const turnSequenceRef = useRef(0);
  const activeTurnIdRef = useRef(0);
  const finalizedTurnIdRef = useRef<number | null>(null);
  const finalizeReasonRef = useRef<FinalizeReason | null>(null);
  const mainPhaseRef = useRef<MainPhase>("wake");
  const isAnalyzingRef = useRef(false);
  const isDeliveringResponseRef = useRef(false);
  const isLiveStreamingRef = useRef(false);
  const wakeRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandSilenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommandStartRef = useRef(false);
  const liveReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePlaybackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveProcessingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outcomeResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextLiveTurnRef = useRef(false);
  const restartWakeAfterResponseRef = useRef(false);
  const showSuccessAfterResponseRef = useRef(false);
  const heardLiveSpeechRef = useRef(false);
  const lastLiveSpeechAtRef = useRef(0);
  const responsePlaybackStartedRef = useRef(false);
  const responsePlaybackCompletedRef = useRef(false);
  const followUpResponseTextRef = useRef<string | null>(null);
  const followUpShowSuccessRef = useRef(false);
  const responseAudioUriRef = useRef<string | null>(null);
  const pendingResponseAudioUriRef = useRef<string | null>(null);
  const responsePlayAttemptCountRef = useRef(0);
  const responseStartRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFallbackTextRef = useRef("");
  const micStreamerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const liveReadyRef = useRef(false);
  const currentLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveReconnectAttemptsRef = useRef(0);
  const handlingInboundDeliveryIdRef = useRef<string | null>(null);
  const relayHealthCheckedAtRef = useRef(0);
  const relayHealthPromiseRef = useRef<Promise<void> | null>(null);
  const relayHealthyRef = useRef(false);
  const currentAudioModeRef = useRef<AudioModeState>(null);
  const audioModeTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const beepPlayer = useAudioPlayer(require("../../../assets/audio/listen-beep.wav"));
  const confirmPlayer = useAudioPlayer(require("../../../assets/audio/message-captured.wav"));
  const [responsePlayer, setResponsePlayer] = useState(() => createAudioPlayer(null, 200));
  const responsePlayerRef = useRef(responsePlayer);
  const responsePlayerStatus = useAudioPlayerStatus(responsePlayer);

  const recorder = useAudioRecorder(
    {
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true
    },
    () => {}
  );
  const recorderState = useAudioRecorderState(recorder, 120);

  const isSetupListening = recorderState.isRecording;
  const mainListening = mainPhase === "listening" && (isRecognitionRunning || isLiveStreaming);
  const isListening = mode === "main" ? mainListening : isSetupListening;
  const meterLevel = mode === "main" ? (isLiveStreaming ? recorderState.metering ?? speechLevel : speechLevel) : recorderState.metering ?? -60;
  const isProcessing =
    mode === "main" &&
    (mainPhase === "finalizing" || mainPhase === "processing" || mainPhase === "replying" || isAnalyzing || isDeliveringResponse);
  const isSuccess = mode === "main" && mainPhase === "success";
  const isFailed = mode === "main" && mainPhase === "failed";
  const listeningStatusLabel =
    mode !== "main"
      ? ""
      : isListening
        ? `CarTalk luistert${".".repeat(listeningDotCount)}`
        : mainPhase === "wake"
          ? "CarTalk wacht op activatie"
          : "";
  const statusLine =
    mode !== "main"
      ? analysisStatus
      : isListening
        ? listeningStatusLabel
        : isProcessing || isSuccess
          ? ""
          : analysisStatus || listeningStatusLabel;

  const updateMainPhase = (nextPhase: MainPhase) => {
    mainPhaseRef.current = nextPhase;
    setMainPhase(nextPhase);
  };

  const updateAnalyzing = (nextValue: boolean) => {
    isAnalyzingRef.current = nextValue;
    setIsAnalyzing(nextValue);
  };

  const updateDeliveringResponse = (nextValue: boolean) => {
    isDeliveringResponseRef.current = nextValue;
    setIsDeliveringResponse(nextValue);
  };

  const updateLiveStreaming = (nextValue: boolean) => {
    isLiveStreamingRef.current = nextValue;
    setIsLiveStreaming(nextValue);
  };

  useEffect(() => {
    responsePlayerRef.current = responsePlayer;
  }, [responsePlayer]);

  const invalidateActiveTurn = () => {
    activeTurnIdRef.current = 0;
    finalizedTurnIdRef.current = null;
    finalizeReasonRef.current = null;
  };

  const startNewTurn = (initialTranscript: string = "") => {
    resetTurnState();
    turnSequenceRef.current += 1;
    activeTurnIdRef.current = turnSequenceRef.current;
    finalizedTurnIdRef.current = null;
    finalizeReasonRef.current = null;
    commandTranscriptRef.current = initialTranscript.trim();
    setAnalysis(null);
    setAnalysisStatus("");
    return activeTurnIdRef.current;
  };

  const isCurrentTurn = (turnId: number) => turnId > 0 && activeTurnIdRef.current === turnId;

  const speakAlert = (text: string) => {
    if (!text.trim()) {
      return;
    }

    Speech.stop();
    Speech.speak(text, {
      language: "nl-NL",
      pitch: 1,
      rate: 0.95
    });
  };

  const clearLivePlaybackTimeout = () => {
    if (livePlaybackTimeoutRef.current) {
      clearTimeout(livePlaybackTimeoutRef.current);
      livePlaybackTimeoutRef.current = null;
    }
  };

  const clearResponseStartRetry = () => {
    if (responseStartRetryTimeoutRef.current) {
      clearTimeout(responseStartRetryTimeoutRef.current);
      responseStartRetryTimeoutRef.current = null;
    }
  };

  const describePlayerStatus = () =>
    [
      `loaded=${responsePlayerStatus.isLoaded}`,
      `buffering=${responsePlayerStatus.isBuffering}`,
      `playing=${responsePlayerStatus.playing}`,
      `playbackState=${responsePlayerStatus.playbackState}`,
      `timeControl=${responsePlayerStatus.timeControlStatus}`,
      `waiting=${responsePlayerStatus.reasonForWaitingToPlay || "none"}`
    ].join(", ");

  const clearLiveProcessingTimeout = () => {
    if (liveProcessingTimeoutRef.current) {
      clearTimeout(liveProcessingTimeoutRef.current);
      liveProcessingTimeoutRef.current = null;
    }
  };

  const clearLiveReconnect = () => {
    if (liveReconnectTimeoutRef.current) {
      clearTimeout(liveReconnectTimeoutRef.current);
      liveReconnectTimeoutRef.current = null;
    }
  };

  const clearOutcomeReset = () => {
    if (outcomeResetTimeoutRef.current) {
      clearTimeout(outcomeResetTimeoutRef.current);
      outcomeResetTimeoutRef.current = null;
    }
  };

  const stopRecognitionSession = async () => {
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Ignore recognition shutdown errors.
    }

    setIsRecognitionRunning(false);

    try {
      await setIsAudioActiveAsync(false);
    } catch {
      // Ignore deactivate errors; the next audio mode transition will retry.
    }

    // Give iOS a brief moment to release the speech/audio session before playback starts.
    await delay(320);
  };

  const teardownActiveVoiceIo = async () => {
    clearCommandStart();
    clearCommandSilenceTimeout();
    clearLivePlaybackTimeout();
    clearResponseStartRetry();
    clearLiveProcessingTimeout();
    ignoreNextLiveTurnRef.current = true;
    restartWakeAfterResponseRef.current = false;
    showSuccessAfterResponseRef.current = false;
    followUpResponseTextRef.current = null;
    followUpShowSuccessRef.current = false;
    resetLivePlayback();
    if (liveReadyRef.current) {
      liveSessionRef.current?.sendRealtimeAudioEnd();
    }
    await stopLiveMicStreaming();
    await stopRecognitionSession();
    await clearResponseAudioFile();
  };

  const resetLivePlayback = () => {
    clearLivePlaybackTimeout();
    clearResponseStartRetry();
    liveFallbackTextRef.current = "";
    responsePlaybackStartedRef.current = false;
    responsePlaybackCompletedRef.current = false;
    pendingResponseAudioUriRef.current = null;
    responsePlayAttemptCountRef.current = 0;
    responsePlayerRef.current.pause();
    try {
      void responsePlayerRef.current.seekTo(0);
    } catch {
      // Ignore player seek cleanup failures.
    }
  };

  const resetTurnState = () => {
    clearCommandStart();
    clearCommandSilenceTimeout();
    clearLivePlaybackTimeout();
    clearLiveProcessingTimeout();
    clearResponseStartRetry();
    clearOutcomeReset();
    pendingCommandStartRef.current = false;
    ignoreNextLiveTurnRef.current = false;
    restartWakeAfterResponseRef.current = false;
    showSuccessAfterResponseRef.current = false;
    followUpResponseTextRef.current = null;
    followUpShowSuccessRef.current = false;
    heardLiveSpeechRef.current = false;
    lastLiveSpeechAtRef.current = 0;
    commandTranscriptRef.current = "";
    clearWakeTranscriptBuffer();
    liveFallbackTextRef.current = "";
    responsePlaybackStartedRef.current = false;
    responsePlaybackCompletedRef.current = false;
    pendingResponseAudioUriRef.current = null;
    responsePlayAttemptCountRef.current = 0;
    updateAnalyzing(false);
    updateDeliveringResponse(false);
    updateLiveStreaming(false);
    setSpeechLevel(-60);
  };

  const restartWakeAfterDelay = (delay = 350) => {
    clearWakeRestart();
    wakeRestartTimeoutRef.current = setTimeout(() => {
      void startWakeRecognition();
    }, delay);
  };

  const completeWithoutReply = (message: string, delay = 650) => {
    invalidateActiveTurn();
    void (async () => {
      await teardownActiveVoiceIo();
      resetTurnState();
      updateMainPhase("wake");
      setAnalysisStatus(message);
      restartWakeAfterDelay(delay);
    })();
  };

  const toRelayFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const normalized = message.toLowerCase();

    if (normalized.includes("/health") || normalized.includes("verbinding") || normalized.includes("network")) {
      return "CarTalk kan Gemini nu niet bereiken. Controleer of de lokale relay-server draait.";
    }

    return message || "CarTalk kan Gemini nu niet bereiken.";
  };

  const ensureRelayHealth = async ({ force = false, surfaceFailure = false } = {}) => {
    const now = Date.now();

    if (!force && relayHealthyRef.current && now - relayHealthCheckedAtRef.current < 8_000) {
      return;
    }

    if (relayHealthPromiseRef.current) {
      return relayHealthPromiseRef.current;
    }

    relayHealthPromiseRef.current = (async () => {
      try {
        await requestRelayHealth();
        relayHealthyRef.current = true;
        relayHealthCheckedAtRef.current = Date.now();
        if (surfaceFailure && mainPhaseRef.current === "wake") {
          setAnalysisStatus("");
        }
      } catch (error) {
        relayHealthyRef.current = false;
        relayHealthCheckedAtRef.current = 0;
        if (surfaceFailure && mainPhaseRef.current === "wake") {
          setAnalysisStatus(toRelayFailureMessage(error));
        }
        throw error;
      } finally {
        relayHealthPromiseRef.current = null;
      }
    })();

    return relayHealthPromiseRef.current;
  };

  const toReplyFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const normalized = message.toLowerCase();

    if (normalized.includes("unavailable") || normalized.includes("\"code\":503")) {
      return "Gemini is tijdelijk te druk om te antwoorden.";
    }

    if (normalized.includes("timed out")) {
      return "Gemini reageerde niet snel genoeg.";
    }

    if (normalized.includes("geen audio") || normalized.includes("no audio")) {
      return "Gemini gaf geen spraakreactie terug.";
    }

    if (normalized.includes("write") || normalized.includes("cachemap")) {
      return "Gemini-audio kon niet lokaal worden opgeslagen.";
    }

    if (normalized.includes("network") || normalized.includes("verbinding") || normalized.includes("/live-speak")) {
      return "CarTalk kon Gemini-audio niet ophalen.";
    }

    if (normalized.includes("/health")) {
      return "CarTalk kan Gemini nu niet bereiken.";
    }

    if (normalized.includes("player") || normalized.includes("afspelen") || normalized.includes("playback")) {
      return "Gemini-audio kon niet worden afgespeeld.";
    }

    return message || "Gemini-audio kon niet worden geladen.";
  };

  const toAnalysisFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const normalized = message.toLowerCase();

    if (normalized.includes("duurde te lang") || normalized.includes("timed out")) {
      return "Gemini deed te lang over het verwerken van je melding.";
    }

    if (
      normalized.includes("unavailable") ||
      normalized.includes("\"code\":503") ||
      normalized.includes("resource_exhausted") ||
      normalized.includes("quota") ||
      normalized.includes("rate limit") ||
      normalized.includes("\"code\":429")
    ) {
      return "Gemini is tijdelijk te druk om je melding te analyseren.";
    }

    if (normalized.includes("network") || normalized.includes("verbinding") || normalized.includes("/analyze-transcript")) {
      return "CarTalk kon je melding niet analyseren door een netwerkprobleem.";
    }

    return message || "Analyseren mislukt.";
  };

  const markTurnFailed = (message: string) => {
    invalidateActiveTurn();
    void (async () => {
      await teardownActiveVoiceIo();
      resetTurnState();
      updateMainPhase("failed");
      setAnalysisStatus(message);
      clearOutcomeReset();
      outcomeResetTimeoutRef.current = setTimeout(() => {
        void startWakeRecognition();
      }, 1000);
    })();
  };

  const clearResponseAudioFile = async () => {
    const currentUri = responseAudioUriRef.current;
    responseAudioUriRef.current = null;

    if (!currentUri) {
      return;
    }

    try {
      await FileSystem.deleteAsync(currentUri, { idempotent: true });
    } catch {
      // Ignore cache cleanup failures.
    }
  };

  const buildResponseAudioUri = () => `${FileSystem.cacheDirectory}cartalk-reply-${Date.now()}.wav`;

  const prepareBase64ResponseAudio = async (base64Audio: string) => {
    if (!FileSystem.cacheDirectory) {
      throw new Error("Geen lokale cachemap beschikbaar voor audio.");
    }

    await clearResponseAudioFile();
    const destinationUri = buildResponseAudioUri();
    if (!base64Audio.trim()) {
      throw new Error("Gemini gaf geen audio terug om lokaal op te slaan.");
    }
    await FileSystem.writeAsStringAsync(destinationUri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64
    });
    responseAudioUriRef.current = destinationUri;
    return destinationUri;
  };

  const replaceResponsePlayer = (source: { uri: string } | null) => {
    const previousPlayer = responsePlayerRef.current;
    const nextPlayer = createAudioPlayer(source, 200);
    nextPlayer.volume = 1;
    responsePlayerRef.current = nextPlayer;
    setResponsePlayer(nextPlayer);

    try {
      previousPlayer.pause();
    } catch {
      // Ignore cleanup failures while swapping players.
    }

    try {
      previousPlayer.remove();
    } catch {
      // Ignore remove failures; next player is already active.
    }
  };

  const queueResponsePlayback = async (audioUri: string, turnId: number) => {
    if (!isCurrentTurn(turnId)) {
      return;
    }

    resetLivePlayback();
    pendingResponseAudioUriRef.current = audioUri;
    responsePlaybackStartedRef.current = false;
    responsePlaybackCompletedRef.current = false;
    responsePlayAttemptCountRef.current = 0;
    setAnalysisStatus("CarTalk laadt Gemini-audio...");
    replaceResponsePlayer({ uri: audioUri });
    clearLivePlaybackTimeout();
    livePlaybackTimeoutRef.current = setTimeout(() => {
      if (responsePlaybackStartedRef.current || !isDeliveringResponseRef.current || !isCurrentTurn(turnId)) {
        return;
      }

      console.warn("[CarTalk] Gemini playback start timed out", describePlayerStatus());
      markTurnFailed("Gemini-audio kon niet worden afgespeeld.");
    }, 15000);
  };

  const attemptQueuedResponsePlayback = async (turnId: number) => {
    if (!isCurrentTurn(turnId) || !isDeliveringResponseRef.current || responsePlaybackStartedRef.current) {
      return;
    }

    if (!pendingResponseAudioUriRef.current) {
      return;
    }

    const currentStatus = responsePlayer.currentStatus;
    if (!currentStatus.isLoaded) {
      setAnalysisStatus("CarTalk laadt Gemini-audio...");
      return;
      }

      responsePlayAttemptCountRef.current += 1;
      clearResponseStartRetry();

      try {
        if (currentAudioModeRef.current !== "playback") {
          await setPlaybackAudioMode();
        } else {
          await setIsAudioActiveAsync(true);
        }

        responsePlayerRef.current.volume = 1;
        responsePlayerRef.current.play();
        setAnalysisStatus("CarTalk start Gemini-reactie...");
      } catch (error) {
        console.warn(
          "[CarTalk] Gemini playback attempt failed",
          error instanceof Error ? error.message : error
      );
    }

    if (responsePlayAttemptCountRef.current < 4 && !responsePlaybackStartedRef.current) {
      responseStartRetryTimeoutRef.current = setTimeout(() => {
        void attemptQueuedResponsePlayback(turnId);
      }, responsePlayAttemptCountRef.current === 1 ? 420 : 720);
    }
  };

  const playConfirmBeep = () => {
    try {
      confirmPlayer.volume = 1;
      void confirmPlayer.seekTo(0);
      confirmPlayer.play();
    } catch {
      // Keep processing even if the confirmation sound fails.
    }
  };

  const queueFollowUpResponse = (text: string | null, showSuccessAfterPlayback: boolean) => {
    followUpResponseTextRef.current = text?.trim() ? text.trim() : null;
    followUpShowSuccessRef.current = showSuccessAfterPlayback;
  };

  const transitionAudioMode = async (nextMode: AudioModeState) => {
    const apply = async () => {
      if (currentAudioModeRef.current === nextMode && nextMode !== null) {
        return;
      }

      let lastError: unknown = null;
      const config =
        nextMode === "listening"
          ? {
              playsInSilentMode: true,
              allowsRecording: true,
              shouldPlayInBackground: true
            }
          : {
              playsInSilentMode: true,
              allowsRecording: false,
              shouldPlayInBackground: true
            };

      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          if (currentAudioModeRef.current && currentAudioModeRef.current !== nextMode) {
            await setIsAudioActiveAsync(false);
            await delay(220);
          }
          await setAudioModeAsync(config);
          await setIsAudioActiveAsync(true);
          currentAudioModeRef.current = nextMode;
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          const retryDelay = message.includes("!pri") || message.includes("priority") ? 280 : 160;
          await delay(retryDelay + attempt * 80);
        }
      }

      if (nextMode === "listening") {
        throw lastError instanceof Error ? lastError : new Error("Luistermodus kon niet worden gestart.");
      }

      throw lastError instanceof Error ? lastError : new Error("Playbackmodus kon niet worden gestart.");
    };

    audioModeTransitionRef.current = audioModeTransitionRef.current.then(apply, apply);
    return audioModeTransitionRef.current;
  };

  const setListeningAudioMode = async () => transitionAudioMode("listening");

  const setPlaybackAudioMode = async () => transitionAudioMode("playback");

  const stopLiveMicStreaming = async () => {
    const streamer = micStreamerRef.current;
    micStreamerRef.current = null;

    if (streamer) {
      try {
        await streamer.stop();
      } catch {
        // Ignore live mic shutdown errors; we'll still move to the next audio state.
      }
    }

    updateLiveStreaming(false);
    setSpeechLevel(-60);
    await new Promise<void>((resolve) => setTimeout(resolve, 140));
  };

  const stopAllVoiceActivity = (status: string = "CarTalk is gestopt.") => {
    clearWakeRestart();
    invalidateActiveTurn();
    void (async () => {
      await teardownActiveVoiceIo();
      resetTurnState();
      setAnalysisStatus(status);
      updateMainPhase("wake");
      restartWakeAfterDelay(500);
    })();
  };

  const clearWakeRestart = () => {
    if (wakeRestartTimeoutRef.current) {
      clearTimeout(wakeRestartTimeoutRef.current);
      wakeRestartTimeoutRef.current = null;
    }
  };

  const clearWakeTranscriptBuffer = () => {
    wakeTranscriptBufferRef.current = [];
  };

  const scheduleWakeRestart = (delay = 350) => {
    restartWakeAfterDelay(delay);
  };

  const pushWakeTranscript = (transcript: string) => {
    const normalized = normalizeSpeech(transcript);
    if (!normalized) {
      return "";
    }

    const current = wakeTranscriptBufferRef.current;
    const lastEntry = current[current.length - 1];

    if (lastEntry !== normalized) {
      wakeTranscriptBufferRef.current = [...current.slice(-3), normalized];
    }

    return wakeTranscriptBufferRef.current.join(" ").trim();
  };

  const clearCommandStart = () => {
    if (commandStartTimeoutRef.current) {
      clearTimeout(commandStartTimeoutRef.current);
      commandStartTimeoutRef.current = null;
    }
  };

  const clearCommandSilenceTimeout = () => {
    if (commandSilenceTimeoutRef.current) {
      clearTimeout(commandSilenceTimeoutRef.current);
      commandSilenceTimeoutRef.current = null;
    }
  };

  const requestFinalize = (reason: FinalizeReason, transcriptOverride?: string) => {
    if (mode !== "main") {
      return;
    }

    const turnId = activeTurnIdRef.current;
    if (!turnId || mainPhaseRef.current !== "listening" || finalizedTurnIdRef.current === turnId) {
      return;
    }

    const mergedTranscript = typeof transcriptOverride === "string" ? transcriptOverride.trim() : commandTranscriptRef.current.trim();
    const strippedTranscript = includesSubmitCommand(mergedTranscript)
      ? mergeTranscriptSnapshot(commandTranscriptRef.current, stripSubmitCommand(mergedTranscript))
      : mergedTranscript;
    const finalTranscript = strippedTranscript.trim();

    finalizedTurnIdRef.current = turnId;
    finalizeReasonRef.current = reason;
    clearCommandStart();
    clearCommandSilenceTimeout();
    clearLiveProcessingTimeout();

    if (!finalTranscript) {
      completeWithoutReply("Geen duidelijke melding gehoord. Probeer het nog eens.");
      return;
    }

    // Capture transcript now — the ref may be overwritten by a stale recognizer
    // result event that fires between stopLiveMicStreaming and stopRecognitionSession.
    const capturedTranscript = finalTranscript;
    const shouldPlayBeep = reason !== "speech_timeout";

    commandTranscriptRef.current = capturedTranscript;
    updateMainPhase("finalizing");
    setAnalysisStatus("CarTalk verwerkt je melding...");

    void (async () => {
      // Stop mic first while audio session is still in recording mode.
      await stopLiveMicStreaming();
      await stopRecognitionSession();
      await setPlaybackAudioMode();
      if (shouldPlayBeep) {
        playConfirmBeep();
        await delay(120);
      }
      if (liveReadyRef.current) {
        liveSessionRef.current?.sendRealtimeAudioEnd();
      }

      if (!isCurrentTurn(turnId) || finalizedTurnIdRef.current !== turnId) {
        return;
      }

      // Use the locally captured transcript rather than re-reading the ref,
      // which may have been overwritten during the await gap above (Fix #2).
      void runTranscriptAnalysis(capturedTranscript, turnId);
    })();
  };

  const finalizeCurrentCommand = (reason: FinalizeReason = "submit") => {
    requestFinalize(reason, commandTranscriptRef.current.trim());
  };

  const finalizeLiveCommand = (transcriptOverride?: string, reason: FinalizeReason = "submit") => {
    requestFinalize(reason, transcriptOverride ?? commandTranscriptRef.current.trim());
  };

  const scheduleCommandSilenceTimeout = () => {
    clearCommandSilenceTimeout();
    commandSilenceTimeoutRef.current = setTimeout(() => {
      if (commandTranscriptRef.current.trim()) {
        finalizeCurrentCommand("silence");
      }
    }, COMMAND_SILENCE_TIMEOUT_MS);
  };

  const scheduleLiveFinalizeTimeout = (delay = 3000) => {
    clearCommandSilenceTimeout();
    commandSilenceTimeoutRef.current = setTimeout(() => {
      if (
        mainPhaseRef.current === "listening" &&
        !isAnalyzingRef.current &&
        !isDeliveringResponseRef.current &&
        commandTranscriptRef.current.trim()
      ) {
        finalizeLiveCommand(commandTranscriptRef.current.trim(), "relay_vad_end");
      }
    }, delay);
  };

  const startWakeRecognition = async () => {
    clearWakeRestart();
    invalidateActiveTurn();
    resetTurnState();
    updateMainPhase("wake");
    setAnalysis(null);
    setAnalysisStatus("");

    await setListeningAudioMode();
    ExpoSpeechRecognitionModule.start({
      lang: "nl-NL",
      interimResults: true,
      continuous: true,
      addsPunctuation: false,
      requiresOnDeviceRecognition: Platform.OS === "ios" && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      iosTaskHint: "confirmation",
      contextualStrings: [
        "Hey CarTalk",
        "Hey Car Talk",
        "CarTalk",
        "car talk",
        "cartalk",
        "rode Mercedes",
        "verlichting",
        "achterlicht",
        "band",
        "deur",
        "klep"
      ],
      volumeChangeEventOptions: {
        enabled: true,
        intervalMillis: 120
      }
    });
  };

  const startCommandRecognition = async () => {
    clearWakeRestart();
    clearCommandStart();
    clearCommandSilenceTimeout();
    if (!activeTurnIdRef.current) {
      startNewTurn(commandTranscriptRef.current.trim());
    }
    updateLiveStreaming(false);
    updateMainPhase("listening");
    setAnalysisStatus("CarTalk luistert...");
    setSpeechLevel(commandTranscriptRef.current.trim() ? -6 : -60);
    resetLivePlayback();

    try {
      beepPlayer.volume = 1;
      beepPlayer.pause();
      await beepPlayer.seekTo(0);
      beepPlayer.play();
    } catch {
      // Keep moving even if the activation sound itself fails.
    }

    commandStartTimeoutRef.current = setTimeout(() => {
      void (async () => {
        await setListeningAudioMode();
        ExpoSpeechRecognitionModule.start({
          lang: "nl-NL",
          interimResults: true,
          continuous: true,
          addsPunctuation: true,
          iosTaskHint: "dictation",
          contextualStrings: [
            "kenteken",
            "verlichting uit",
            "achterlicht kapot",
            "band zacht",
            "deur open",
            "klep open",
            "zwarte Volvo",
            "grijze Mercedes",
            "verstuur",
            "verzend",
            "einde bericht",
            "dat was het"
          ],
          volumeChangeEventOptions: {
            enabled: true,
            intervalMillis: 120
          }
        });
        pendingCommandStartRef.current = false;
        if (commandTranscriptRef.current.trim()) {
          scheduleCommandSilenceTimeout();
        }
      })();
    }, 280);
  };

  const startOverlayCommandRecognition = async () => {
    try {
      await setListeningAudioMode();
      ExpoSpeechRecognitionModule.start({
        lang: "nl-NL",
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        iosTaskHint: "dictation",
        contextualStrings: [
          "kenteken",
          "verlichting uit",
          "achterlicht kapot",
          "band zacht",
          "deur open",
          "klep open",
          "zwarte Volvo",
          "rode Mercedes",
          "ABC 123",
          "verstuur",
          "verzend",
          "einde bericht",
          "dat was het",
          "stop cartalk"
        ],
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 120
        }
      });
    } catch (overlayErr) {
      // Live audio continues, but stop/submit commands fall back to Gemini transcription only.
      console.warn("[CarTalk] Overlay recognizer failed to start:", overlayErr);
    }
  };

  const startLiveStreaming = async () => {
    // The combined iOS path of local speech recognition + live mic streaming
    // caused recurring AVAudioEngine format conflicts in production testing.
    // Keep the command phase on the stable local recognizer path:
    // wake word locally, capture command locally, analyze via Gemini server-side,
    // and speak the result back via Gemini audio.
    await startCommandRecognition();
  };

  const speakLiveAlert = (text: string, showSuccessAfterPlayback: boolean, turnId: number) => {
    if (!text.trim()) {
      return;
    }

    if (!isCurrentTurn(turnId)) {
      return;
    }

    liveFallbackTextRef.current = text;
    showSuccessAfterResponseRef.current = showSuccessAfterPlayback;

    responsePlayerRef.current.pause();
    updateDeliveringResponse(true);
    updateMainPhase("replying");
    restartWakeAfterResponseRef.current = true;
    setAnalysisStatus("");

    void (async () => {
      const spokenPrompt =
        "Speak this CarTalk spoken reply naturally for a driver in the same language as the text. " +
        "Keep the delivery calm, short, and clear. " +
        text;
      try {
        if (currentAudioModeRef.current !== "playback") {
          await setPlaybackAudioMode();
          await delay(120);
        }
        if (!isCurrentTurn(turnId)) {
          return;
        }
        await ensureRelayHealth();
        if (!isCurrentTurn(turnId)) {
          return;
        }
        setAnalysisStatus("CarTalk laadt Gemini-audio...");
        responsePlaybackStartedRef.current = false;
        responsePlayerRef.current.volume = 1;
        const spoken = await Promise.race([
          requestLiveSpokenAlert(spokenPrompt, state.voiceOutputStyle),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Gemini-audio duurde te lang om te laden.")), 15_000)
          )
        ]);
        if (!isCurrentTurn(turnId)) {
          return;
        }
        const audioUri = await prepareBase64ResponseAudio(spoken.audioBase64);
        if (!isCurrentTurn(turnId)) {
          return;
        }
        await queueResponsePlayback(audioUri, turnId);
      } catch (error) {
        markTurnFailed(toReplyFailureMessage(error));
      }
    })();
  };

  const runTranscriptAnalysis = async (transcript: string, turnId: number) => {
    if (!isCurrentTurn(turnId)) {
      return;
    }

    try {
      await ensureRelayHealth();
      if (!isCurrentTurn(turnId)) {
        return;
      }
      updateAnalyzing(true);
      updateMainPhase("processing");
      setAnalysisStatus("CarTalk verwerkt je melding...");
      clearLiveProcessingTimeout();
      liveProcessingTimeoutRef.current = setTimeout(() => {
        if (!isCurrentTurn(turnId) || mainPhaseRef.current !== "processing") {
          return;
        }
        markTurnFailed("Gemini deed te lang over het verwerken van je melding.");
      }, ANALYSIS_TIMEOUT_MS);
      const nextAnalysis = await withTimeout(
        analyzeDriverTranscript(transcript),
        ANALYSIS_TIMEOUT_MS,
        "Gemini deed te lang over het verwerken van je melding."
      );
      if (!isCurrentTurn(turnId) || finalizedTurnIdRef.current !== turnId) {
        return;
      }
      setAnalysis(nextAnalysis);
      const recipientResolution = state.voiceDeliveryConfirmationEnabled
        ? await withTimeout(
            resolveRecipientForAnalysis(nextAnalysis, state.vehicleProfile, currentLocationRef.current),
            RECIPIENT_RESOLUTION_TIMEOUT_MS,
            "Recipient resolution timed out."
          ).catch(() => ({
            status: "not_found" as const,
            vehicleHint: nextAnalysis.targetDescription
          }))
        : {
            status: "not_found" as const,
            vehicleHint: nextAnalysis.targetDescription
          };
      if (!isCurrentTurn(turnId) || finalizedTurnIdRef.current !== turnId) {
        return;
      }
      const spokenReply = buildSpokenSenderReply(nextAnalysis);
      let finalRecipientResolution = recipientResolution;

      if (
        nextAnalysis.applicable &&
        finalRecipientResolution.status === "found" &&
        finalRecipientResolution.lookupSource === "firebase"
      ) {
        const recipientUserId = finalRecipientResolution.userId || "";
        const recipientIsReachable =
          Boolean(recipientUserId) &&
          recipientUserId !== state.userId &&
          finalRecipientResolution.isOnline !== false;

        if (recipientIsReachable) {
          try {
            await withTimeout(
              sendLiveDelivery(recipientUserId, {
                senderUserId: state.userId,
                receiverOutput: nextAnalysis.receiverOutput || spokenReply,
                senderVehicleLabel: describeVehicleProfile(state.vehicleProfile),
                createdAt: Date.now()
              }),
              2500,
              "Live delivery timed out."
            );
          } catch {
            finalRecipientResolution = {
              ...finalRecipientResolution,
              isOnline: false
            };
          }
        } else {
          finalRecipientResolution = {
            ...finalRecipientResolution,
            isOnline: false
          };
        }
      }

      const followUpReply = buildDeliveryConfirmationReply(
        nextAnalysis,
        finalRecipientResolution,
        state.voiceDeliveryConfirmationEnabled
      );
      queueFollowUpResponse(
        followUpReply,
        shouldShowSentSuccess(nextAnalysis, finalRecipientResolution, state.voiceDeliveryConfirmationEnabled)
      );
      speakLiveAlert(
        spokenReply,
        !followUpReply &&
          shouldShowSentSuccess(nextAnalysis, finalRecipientResolution, state.voiceDeliveryConfirmationEnabled),
        turnId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyseren mislukt.";

      if (message.includes("Missing GEMINI_API_KEY")) {
        const demoAnalysis = {
          rawText: "Demo mode",
          transcript,
          applicable: true,
          reasonCategory: "vehicle_safety",
          receiverOutput: "Een bestuurder heeft gemeld dat uw verlichting uit staat.",
          targetDescription: "onbekend",
          senderReply: "Een bestuurder heeft gemeld dat uw verlichting uit staat."
        };
        if (!isCurrentTurn(turnId) || finalizedTurnIdRef.current !== turnId) {
          return;
        }
        setAnalysis(demoAnalysis);
        setAnalysisStatus("Demo-uitvoer afgespeeld. Voeg GEMINI_API_KEY toe voor echte AI-verwerking.");
        speakLiveAlert(demoAnalysis.senderReply, true, turnId);
      } else if (isCurrentTurn(turnId)) {
        markTurnFailed(toAnalysisFailureMessage(error));
      }
    } finally {
      clearLiveProcessingTimeout();
      updateAnalyzing(false);
    }
  };

  useSpeechRecognitionEvent("start", () => {
    setIsRecognitionRunning(true);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsRecognitionRunning(false);

    if (mode !== "main") {
      return;
    }

    if (pendingCommandStartRef.current || isLiveStreamingRef.current) {
      return;
    }

    if (mainPhaseRef.current === "wake" && !isAnalyzingRef.current && !isDeliveringResponseRef.current) {
      scheduleWakeRestart(350);
      return;
    }

    if (
      mainPhaseRef.current === "listening" &&
      !isAnalyzingRef.current &&
      !isDeliveringResponseRef.current &&
      !isLiveStreamingRef.current
    ) {
      clearCommandSilenceTimeout();
      const finalTranscript = commandTranscriptRef.current.trim();

      if (finalTranscript) {
        finalizeCurrentCommand("recognizer_end");
      } else {
        completeWithoutReply("Geen duidelijke melding gehoord. Probeer het nog eens.");
      }
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (mode !== "main") {
      return;
    }

    const latestTranscript = extractBestTranscript(event.results);

    if (!latestTranscript) {
      return;
    }

    if (isStopCommand(latestTranscript)) {
      stopAllVoiceActivity();
      return;
    }

    if (mainPhaseRef.current === "wake") {
      setSpeechLevel(-18);
      const combinedWakeTranscript = pushWakeTranscript(latestTranscript);

      if (includesWakePhrase(combinedWakeTranscript || latestTranscript)) {
        onActivateDrivingMode();
        startNewTurn(stripWakePhrase(combinedWakeTranscript || latestTranscript));
        pendingCommandStartRef.current = true;
        ExpoSpeechRecognitionModule.abort();
        void startLiveStreaming();
      }

      return;
    }

    if (mainPhaseRef.current === "listening") {
      const nextTranscript = extractBestTranscript(event.results);
      setSpeechLevel(-6);

      if (isLiveStreamingRef.current) {
        const mergedTranscript = mergeTranscriptSnapshot(commandTranscriptRef.current, nextTranscript);

        if (includesSubmitCommand(nextTranscript)) {
          commandTranscriptRef.current = mergeTranscriptSnapshot(
            commandTranscriptRef.current,
            stripSubmitCommand(nextTranscript)
          );
          finalizeLiveCommand(commandTranscriptRef.current, "submit");
          return;
        }

        commandTranscriptRef.current = mergedTranscript;
        // Only schedule a fallback timer if no timer is already pending (Fix #3).
        // Gemini VAD END sets a 450ms timer; we must not override it with 1200ms.
        if (!commandSilenceTimeoutRef.current) {
          scheduleLiveFinalizeTimeout();
        }
        return;
      }

      if (includesSubmitCommand(nextTranscript)) {
        commandTranscriptRef.current = mergeTranscriptSnapshot(
          commandTranscriptRef.current,
          stripSubmitCommand(nextTranscript)
        );
        finalizeCurrentCommand("submit");
        return;
      }

      commandTranscriptRef.current = nextTranscript;
      scheduleCommandSilenceTimeout();

      if (event.isFinal) {
        finalizeCurrentCommand("recognizer_end");
      }
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    const mapped = Math.max(-60, Math.min(0, event.value * 6 - 60));
    setSpeechLevel(mapped);
  });

  useEffect(() => {
    if (mode !== "main" || mainPhase !== "listening" || !isLiveStreaming) {
      return;
    }

    const meter = recorderState.metering ?? -60;
    setSpeechLevel(meter);

    const now = Date.now();
    if (meter > -38) {
      heardLiveSpeechRef.current = true;
      lastLiveSpeechAtRef.current = now;
      return;
    }

    if (
      heardLiveSpeechRef.current &&
      lastLiveSpeechAtRef.current > 0 &&
      now - lastLiveSpeechAtRef.current > 2600 &&
      !isAnalyzingRef.current &&
      !isDeliveringResponseRef.current &&
      mainPhaseRef.current === "listening"
    ) {
      heardLiveSpeechRef.current = false;
      finalizeLiveCommand(commandTranscriptRef.current, "silence");
    }
  }, [isLiveStreaming, mainPhase, mode, recorderState.metering]);

  useSpeechRecognitionEvent("error", (event) => {
    setIsRecognitionRunning(false);

    if (event.error === "no-speech" || event.error === "speech-timeout") {
      if (mode === "main") {
        if (mainPhaseRef.current === "listening" && commandTranscriptRef.current.trim()) {
          if (isLiveStreamingRef.current) {
            finalizeLiveCommand(commandTranscriptRef.current.trim(), "speech_timeout");
          } else {
            finalizeCurrentCommand("speech_timeout");
          }
        } else {
          restartWakeAfterDelay(350);
        }
      }
      return;
    }

    if (event.error === "service-not-allowed") {
      setAnalysisStatus(
        "Spraakactivatie is hier niet beschikbaar. Test 'Hey CarTalk' op een echte iPhone in plaats van in de simulator."
      );
      return;
    }

    setAnalysisStatus(event.message || "Spraakherkenning mislukt.");
  });

  useEffect(() => {
    let locService: DrivingLocationService | null = null;

    void (async () => {
      try {
        if (mode === "main") {
          const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          setMicPermission(permission.granted ? "granted" : "denied");
          await setListeningAudioMode();
          await startWakeRecognition();
          void ensureRelayHealth({ surfaceFailure: true }).catch(() => {
            // The idle UI already gets a clearer status message via ensureRelayHealth.
          });

          if (state.userId) {
            locService = new DrivingLocationService();
            await locService.start(state.userId, ({ lat, lng }) => {
              currentLocationRef.current = { lat, lng };
            });
          }

          return;
        }

        const permission = await AudioModule.getRecordingPermissionsAsync();
        setMicPermission(permission.granted ? "granted" : "denied");
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          shouldPlayInBackground: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Toestemmingen konden niet worden gestart.";
        setAnalysisStatus(message);
      }
    })();

    return () => {
      clearWakeRestart();
      clearCommandStart();
      clearCommandSilenceTimeout();
      clearLivePlaybackTimeout();
      clearLiveProcessingTimeout();
      clearLiveReconnect();
      clearOutcomeReset();
      Speech.stop();
      responsePlayerRef.current.pause();
      try {
        responsePlayerRef.current.remove();
      } catch {
        // Ignore player removal errors during teardown.
      }
      void clearResponseAudioFile();
      liveSessionRef.current?.disconnect();
      liveSessionRef.current = null;

      if (mode === "main") {
        ExpoSpeechRecognitionModule.abort();
        if (locService && state.userId) {
          void locService.stop(state.userId);
        }
      }
    };
  }, [mode, state.userId]);

  useEffect(() => {
    if (!isListening) {
      setListeningDotCount(1);
    }

    Animated.parallel([
      Animated.timing(listeningStatusOpacity, {
        toValue: isListening ? 1 : 0.72,
        duration: isListening ? 180 : 220,
        useNativeDriver: true
      }),
      Animated.timing(listeningStatusTranslateY, {
        toValue: isListening ? 0 : 2,
        duration: isListening ? 180 : 220,
        useNativeDriver: true
      })
    ]).start();

    if (!isListening) {
      return;
    }

    const interval = setInterval(() => {
      setListeningDotCount((current) => (current % 3) + 1);
    }, 420);

    return () => clearInterval(interval);
  }, [isListening, listeningStatusOpacity, listeningStatusTranslateY]);

  useEffect(() => {
    if (!isDeliveringResponse) {
      return;
    }

    if (
      pendingResponseAudioUriRef.current &&
      responsePlayAttemptCountRef.current === 0 &&
      responsePlayerStatus.isLoaded &&
      !responsePlayerStatus.playing &&
      !responsePlaybackStartedRef.current
    ) {
      void attemptQueuedResponsePlayback(activeTurnIdRef.current);
      return;
    }

    if (responsePlayerStatus.isBuffering) {
      setAnalysisStatus("CarTalk laadt Gemini-audio...");
      return;
    }

    if (responsePlayerStatus.playing) {
      responsePlaybackStartedRef.current = true;
      responsePlaybackCompletedRef.current = false;
      pendingResponseAudioUriRef.current = null;
      clearResponseStartRetry();
      clearLivePlaybackTimeout();
      setAnalysisStatus("");
      if (mainPhaseRef.current !== "replying") {
        updateMainPhase("replying");
      }
      return;
    }

    if (
      pendingResponseAudioUriRef.current &&
      responsePlayAttemptCountRef.current >= 1 &&
      !responsePlayerStatus.isBuffering &&
      !responsePlayerStatus.playing &&
      responsePlayerStatus.isLoaded &&
      !responsePlaybackStartedRef.current &&
      responsePlayerStatus.timeControlStatus !== "playing" &&
      responsePlayerStatus.reasonForWaitingToPlay !== "evaluatingBufferingRate"
    ) {
      if (responsePlayAttemptCountRef.current < 2) {
        clearResponseStartRetry();
        responseStartRetryTimeoutRef.current = setTimeout(() => {
          void attemptQueuedResponsePlayback(activeTurnIdRef.current);
        }, 320);
      }
    }

    if (responsePlaybackStartedRef.current && responsePlayerStatus.didJustFinish && !responsePlaybackCompletedRef.current) {
      responsePlaybackCompletedRef.current = true;
      responsePlaybackStartedRef.current = false;
      pendingResponseAudioUriRef.current = null;
      responsePlayAttemptCountRef.current = 0;
      clearResponseStartRetry();
      clearLivePlaybackTimeout();
      responsePlayerRef.current.pause();
      try {
        void responsePlayerRef.current.seekTo(0);
      } catch {
        // Ignore cleanup failures after playback has already finished.
      }
      void clearResponseAudioFile();

      const followUpText = followUpResponseTextRef.current;
      if (followUpText && activeTurnIdRef.current > 0) {
        const turnId = activeTurnIdRef.current;
        followUpResponseTextRef.current = null;
        const showSuccessAfterFollowUp = followUpShowSuccessRef.current;
        followUpShowSuccessRef.current = false;
        setAnalysisStatus("");
        speakLiveAlert(followUpText, showSuccessAfterFollowUp, turnId);
        return;
      }

      updateDeliveringResponse(false);
      setAnalysisStatus("");
      invalidateActiveTurn();

      if (restartWakeAfterResponseRef.current) {
        restartWakeAfterResponseRef.current = false;
        if (showSuccessAfterResponseRef.current) {
          updateMainPhase("success");
          clearOutcomeReset();
          outcomeResetTimeoutRef.current = setTimeout(() => {
            void startWakeRecognition();
          }, 1000);
        } else {
          void startWakeRecognition();
        }
      }
    }
  }, [
    clearOutcomeReset,
    isDeliveringResponse,
    responsePlayerStatus.didJustFinish,
    responsePlayerStatus.isLoaded,
    responsePlayerStatus.isBuffering,
    responsePlayerStatus.playing,
    responsePlayerStatus.reasonForWaitingToPlay,
    responsePlayerStatus.timeControlStatus
  ]);

  useEffect(() => {
    if (mode !== "main" || pendingInboundDeliveries.length === 0) {
      return;
    }

    if (
      mainPhaseRef.current !== "wake" ||
      isAnalyzingRef.current ||
      isDeliveringResponseRef.current ||
      handlingInboundDeliveryIdRef.current
    ) {
      return;
    }

    const nextDelivery = pendingInboundDeliveries[0];
    if (!nextDelivery) {
      return;
    }

    handlingInboundDeliveryIdRef.current = nextDelivery.id;
    const turnId = startNewTurn("");
    queueFollowUpResponse(null, false);
    setAnalysisStatus("CarTalk ontvangt een veiligheidsmelding...");

    void (async () => {
      try {
        await acknowledgeInboundDelivery(nextDelivery.id);
        if (!isCurrentTurn(turnId)) {
          return;
        }
        speakLiveAlert(nextDelivery.receiverOutput, false, turnId);
      } finally {
        handlingInboundDeliveryIdRef.current = null;
      }
    })();
  }, [acknowledgeInboundDelivery, mode, pendingInboundDeliveries]);

  useEffect(() => {
    if (mode !== "main") {
      return;
    }

    const session = new LiveSession((event) => {
      if (event.type === "ready") {
        liveReadyRef.current = true;
        liveReconnectAttemptsRef.current = 0; // reset backoff on successful connect (Fix #14)
        return;
      }

      if (event.type === "status") {
        if (event.message === "Relay connection closed.") {
          liveReadyRef.current = false;
          void stopLiveMicStreaming();
          clearLiveReconnect();
          liveReconnectAttemptsRef.current += 1;
          const backoffMs = Math.min(1_500 * Math.pow(2, liveReconnectAttemptsRef.current - 1), 30_000);
          liveReconnectTimeoutRef.current = setTimeout(() => {
            session.connect();
          }, backoffMs);
        }
        return;
      }

      if (event.type === "error") {
        liveReadyRef.current = false;
        void stopLiveMicStreaming();
        clearLiveProcessingTimeout();
        clearLiveReconnect();
        // If an error occurs during active listening, try to finalise with what we have (Fix #15).
        if (mainPhaseRef.current === "listening" && commandTranscriptRef.current.trim()) {
          scheduleLiveFinalizeTimeout(1700);
        }
        liveReconnectAttemptsRef.current += 1;
        const backoffMs = Math.min(1_500 * Math.pow(2, liveReconnectAttemptsRef.current - 1), 30_000);
        liveReconnectTimeoutRef.current = setTimeout(() => {
          session.connect();
        }, backoffMs);
        return;
      }

      const inputText = extractGeminiInputTranscription(event.payload);
      if (inputText && mainPhaseRef.current === "listening") {
        commandTranscriptRef.current = mergeTranscriptSnapshot(commandTranscriptRef.current, inputText);
        setSpeechLevel(-6);

        if (isStopCommand(inputText)) {
          stopAllVoiceActivity();
          return;
        }

        if (includesSubmitCommand(inputText)) {
          finalizeLiveCommand(
            mergeTranscriptSnapshot(commandTranscriptRef.current, stripSubmitCommand(inputText))
          );
          return;
        }

        scheduleLiveFinalizeTimeout();
      }

      const voiceActivityType = extractGeminiVoiceActivityType(event.payload);
      if (voiceActivityType && mainPhaseRef.current === "listening") {
        if (voiceActivityType.includes("START")) {
          heardLiveSpeechRef.current = true;
          lastLiveSpeechAtRef.current = Date.now();
          setSpeechLevel(-6);
        }

        if (
          voiceActivityType.includes("END") &&
          isLiveStreamingRef.current &&
          !isAnalyzingRef.current &&
          !isDeliveringResponseRef.current
        ) {
          scheduleLiveFinalizeTimeout(1200);
          return;
        }
      }

      if (isGeminiTurnComplete(event.payload)) {
        clearLiveProcessingTimeout();
      }
    });

    liveSessionRef.current = session;
    session.connect();

    return () => {
      liveReadyRef.current = false;
      updateLiveStreaming(false);
      clearLiveReconnect();
      session.disconnect();
      if (liveSessionRef.current === session) {
        liveSessionRef.current = null;
      }
    };
  }, [mode]);

  const runSetupAnalysis = async (uri: string) => {
    try {
      setIsAnalyzing(true);
      setAnalysisStatus("CarTalk maakt een nette melding voor de ontvanger...");
      const nextAnalysis = await analyzeRecordingFromUri(uri);
      setAnalysis(nextAnalysis);
      setAnalysisStatus("Melding klaar.");
      if (nextAnalysis.senderReply) {
        speakAlert(nextAnalysis.senderReply);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyseren mislukt.";

      if (message.includes("Missing GEMINI_API_KEY")) {
        const demoAnalysis = {
          rawText: "Demo mode",
          transcript: "Demo-opname zonder live Gemini-verwerking.",
          applicable: true,
          reasonCategory: "vehicle_safety",
          receiverOutput: "Een bestuurder heeft gemeld dat uw verlichting uit staat.",
          targetDescription: "onbekend",
          senderReply: "Een bestuurder heeft gemeld dat uw verlichting uit staat."
        };
        setAnalysis(demoAnalysis);
        setAnalysisStatus("Demo-uitvoer afgespeeld. Voeg GEMINI_API_KEY toe voor echte AI-verwerking.");
        speakAlert(demoAnalysis.senderReply);
      } else {
        setAnalysisStatus(message);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSetupVoicePress = async () => {
    if (isSetupListening) {
      await recorder.stop();
      const url = recorder.uri ?? recorder.getStatus().url ?? null;

      if (url) {
        await runSetupAnalysis(url);
      }

      return;
    }

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    const nextState = permission.granted ? "granted" : "denied";
    setMicPermission(nextState);

    if (!permission.granted) {
      return;
    }

    onActivateDrivingMode();
    setAnalysis(null);
    setAnalysisStatus("");
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  return (
    <View style={{ gap: 16, alignItems: "center" }}>
      {mode === "setup" ? (
        <View
          onTouchEnd={() => {
            void handleSetupVoicePress();
          }}
          style={{ width: "100%", alignItems: "center" }}
        >
          <VoiceDock active={active} listening={isListening} level={meterLevel} />
        </View>
      ) : (
        <View style={{ width: "100%", alignItems: "center" }}>
          <VoiceDock
            active={active}
            listening={isListening}
            processing={isProcessing}
            success={isSuccess}
            failed={isFailed}
            level={meterLevel}
          />
        </View>
      )}

      {mode === "main" ? (
        <View style={{ gap: 6, alignItems: "center", maxWidth: 320 }}>
          <Text style={[typography.caption, { textAlign: "center" }]}>Activeer met</Text>
          <Text style={[typography.h1, { textAlign: "center" }]}>Hey CarTalk</Text>
        </View>
      ) : null}

      {statusLine ? (
        <Animated.Text
          style={[
            typography.caption,
            {
              textAlign: "center",
              maxWidth: 320,
              color: isFailed ? "#9B4D3A" : palette.mutedInk,
              opacity: listeningStatusOpacity,
              transform: [{ translateY: listeningStatusTranslateY }]
            }
          ]}
        >
          {statusLine}
        </Animated.Text>
      ) : null}

      {mode !== "main" && analysis && analysis.senderReply ? (
        <View
          style={{
            width: "100%",
            borderRadius: 22,
            backgroundColor: palette.surface,
            borderWidth: 1,
            borderColor: palette.border,
            padding: 16,
            gap: 8
          }}
        >
          <Text style={typography.label}>Ontvanger hoort</Text>
          <Text style={[typography.body, { textAlign: "left" }]}>{analysis.senderReply}</Text>
        </View>
      ) : null}

      {micPermission === "denied" ? (
        <Text style={[typography.caption, { textAlign: "center", color: "#9B4D3A", maxWidth: 320 }]}>
          Microfoon- of spraaktoegang is nog niet toegestaan.
        </Text>
      ) : null}
    </View>
  );
}
