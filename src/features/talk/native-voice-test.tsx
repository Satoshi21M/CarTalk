import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Text, View } from "react-native";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system";
import {
  AudioModule,
  RecordingPresets,
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
import { DrivingLocationService } from "@/lib/location/location-service";
import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";
import { sendLiveDelivery } from "@/lib/firebase/realtime-db";
import { sendHostedDelivery } from "@/lib/live/hosted-network";
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
type FinalizeReason = "submit" | "silence";
type AudioModeState = "listening" | "playback" | null;

const WAKE_PHRASES = [
  "hey cartalk",
  "he cartalk",
  "hé cartalk",
  "hee cartalk",
  "hey car talk",
  "hé car talk",
  "hee car talk",
  "hey kaartalk",
  "hee kaartalk",
  "hey kar talk"
];
const WAKE_GREETING_VARIANTS = ["hey", "he", "hee", "hi", "hoi", "hae"];
const WAKE_CARTALK_VARIANTS = [
  "cartalk",
  "cartalk",
  "car talk",
  "kaartalk",
  "kaart talk",
  "kar talk",
  "car tok",
  "kar tok",
  "cartok",
  "cartak",
  "cartolk",
  "kartalk",
  "kartak",
  "kartok",
  "kartolk"
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
const COMMAND_SILENCE_TIMEOUT_MS = 6500;
const EMPTY_COMMAND_TIMEOUT_MS = 12_000;
const MAX_COMMAND_DURATION_MS = 45_000;
const ANALYSIS_TIMEOUT_MS = 20_000;
const RECIPIENT_RESOLUTION_TIMEOUT_MS = 5_000;
const WAKE_WATCHDOG_INTERVAL_MS = 4_000;
const WAKE_START_STALL_TIMEOUT_MS = 8_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
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
        tail.endsWith(` ${phrase}`)
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
        tail.endsWith(` ${phrase}`)
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

function extractBestTranscript(results: { transcript?: string; confidence?: number }[] | undefined) {
  if (!Array.isArray(results) || results.length === 0) {
    return "";
  }

  const bestResult = [...results]
    .filter((result) => result?.transcript?.trim())
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0];

  return bestResult?.transcript?.trim() || "";
}

export function NativeVoiceTest({ active, mode = "main", onActivateDrivingMode }: NativeVoiceTestProps) {
  const { state, pendingInboundDeliveries, acknowledgeInboundDelivery } = useAppState();
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [analysis, setAnalysis] = useState<RecordingAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeliveringResponse, setIsDeliveringResponse] = useState(false);
  const [mainPhase, setMainPhase] = useState<MainPhase>("wake");
  const [wakeRecognizerReady, setWakeRecognizerReady] = useState(false);
  const [speechLevel, setSpeechLevel] = useState(-60);
  const [listeningDotCount, setListeningDotCount] = useState(1);
  const listeningStatusOpacity = useRef(new Animated.Value(0.75)).current;
  const listeningStatusTranslateY = useRef(new Animated.Value(2)).current;
  const commandTranscriptRef = useRef("");
  const commandStartedAtRef = useRef(0);
  const commandLastResultAtRef = useRef(0);
  const wakeTranscriptBufferRef = useRef<string[]>([]);
  const turnSequenceRef = useRef(0);
  const activeTurnIdRef = useRef(0);
  const finalizedTurnIdRef = useRef<number | null>(null);
  const finalizeReasonRef = useRef<FinalizeReason | null>(null);
  const mainPhaseRef = useRef<MainPhase>("wake");
  const isAnalyzingRef = useRef(false);
  const isDeliveringResponseRef = useRef(false);
  const wakeRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandSilenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeStartPromiseRef = useRef<Promise<void> | null>(null);
  const wakeSessionStartedAtRef = useRef(0);
  const wakeRestartAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const voiceLifecycleActiveRef = useRef(false);
  const pendingCommandStartRef = useRef(false);
  const ignoreRecognitionEndUntilRef = useRef(0);
  const livePlaybackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveProcessingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outcomeResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartWakeAfterResponseRef = useRef(false);
  const showSuccessAfterResponseRef = useRef(false);
  const responsePlaybackStartedRef = useRef(false);
  const responsePlaybackCompletedRef = useRef(false);
  const followUpResponseTextRef = useRef<string | null>(null);
  const followUpShowSuccessRef = useRef(false);
  const responseAudioUriRef = useRef<string | null>(null);
  const pendingResponseAudioUriRef = useRef<string | null>(null);
  const responsePlayAttemptCountRef = useRef(0);
  const responseStartRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFallbackTextRef = useRef("");
  const currentLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const handlingInboundDeliveryIdRef = useRef<string | null>(null);
  const inboundDeliveryToAcknowledgeRef = useRef<string | null>(null);
  const relayHealthCheckedAtRef = useRef(0);
  const relayHealthPromiseRef = useRef<Promise<void> | null>(null);
  const relayHealthyRef = useRef(false);
  const currentAudioModeRef = useRef<AudioModeState>(null);
  const audioModeTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const beepPlayer = useAudioPlayer(require("../../../assets/audio/listen-beep.wav"));
  const confirmPlayer = useAudioPlayer(require("../../../assets/audio/message-captured.wav"));
  const responsePlayer = useAudioPlayer(null, 100);
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
  const mainListening = mainPhase === "listening";
  const isListening = mode === "main" ? mainListening : isSetupListening;
  const meterLevel = mode === "main" ? speechLevel : recorderState.metering ?? -60;
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
          ? wakeRecognizerReady
            ? "CarTalk wacht op activatie"
            : "CarTalk start spraakactivatie..."
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
    commandStartedAtRef.current = Date.now();
    commandLastResultAtRef.current = initialTranscript.trim() ? Date.now() : 0;
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

  const clearOutcomeReset = () => {
    if (outcomeResetTimeoutRef.current) {
      clearTimeout(outcomeResetTimeoutRef.current);
      outcomeResetTimeoutRef.current = null;
    }
  };

  const waitForRecognitionToStop = async (timeoutMs = 1200) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if ((await ExpoSpeechRecognitionModule.getStateAsync()) === "inactive") {
          return;
        }
      } catch {
        return;
      }
      await delay(60);
    }
  };

  const stopRecognitionSession = async ({ abort = true }: { abort?: boolean } = {}) => {
    ignoreRecognitionEndUntilRef.current = Date.now() + 1500;
    setWakeRecognizerReady(false);
    wakeSessionStartedAtRef.current = 0;
    try {
      if (abort) {
        ExpoSpeechRecognitionModule.abort();
      } else {
        ExpoSpeechRecognitionModule.stop();
      }
    } catch {
      // Ignore recognition shutdown errors.
    }

    await waitForRecognitionToStop();

    try {
      await setIsAudioActiveAsync(false);
    } catch {
      // Ignore deactivate errors; the next audio mode transition will retry.
    }

    // Let AVAudioEngine release its tap before another player changes the shared session.
    await delay(120);
  };

  const teardownActiveVoiceIo = async () => {
    clearCommandStart();
    clearCommandSilenceTimeout();
    clearLivePlaybackTimeout();
    clearResponseStartRetry();
    clearLiveProcessingTimeout();
    restartWakeAfterResponseRef.current = false;
    showSuccessAfterResponseRef.current = false;
    followUpResponseTextRef.current = null;
    followUpShowSuccessRef.current = false;
    resetLivePlayback();
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
    restartWakeAfterResponseRef.current = false;
    showSuccessAfterResponseRef.current = false;
    followUpResponseTextRef.current = null;
    followUpShowSuccessRef.current = false;
    commandTranscriptRef.current = "";
    commandStartedAtRef.current = 0;
    commandLastResultAtRef.current = 0;
    clearWakeTranscriptBuffer();
    liveFallbackTextRef.current = "";
    responsePlaybackStartedRef.current = false;
    responsePlaybackCompletedRef.current = false;
    pendingResponseAudioUriRef.current = null;
    responsePlayAttemptCountRef.current = 0;
    updateAnalyzing(false);
    updateDeliveringResponse(false);
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
      return "CarTalk kan de online service nu niet bereiken. Controleer je internetverbinding.";
    }

    return message || "CarTalk kan Gemini nu niet bereiken.";
  };

  const ensureRelayHealth = async ({ force = false, surfaceFailure = false } = {}) => {
    const now = Date.now();

    if (!force && relayHealthyRef.current && now - relayHealthCheckedAtRef.current < 5 * 60_000) {
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
    handlingInboundDeliveryIdRef.current = null;
    inboundDeliveryToAcknowledgeRef.current = null;
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
    try {
      responsePlayerRef.current.pause();
    } catch {
      // The player may still be empty on the first turn.
    }

    responsePlayerRef.current.replace(source);
    responsePlayerRef.current.volume = 1;
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

    // Capture now because iOS may still emit a final result while recognition stops.
    const capturedTranscript = finalTranscript;
    commandTranscriptRef.current = capturedTranscript;
    updateMainPhase("finalizing");
    setAnalysisStatus("CarTalk verwerkt je melding...");

    void (async () => {
      await stopRecognitionSession({ abort: false });
      await setPlaybackAudioMode();
      playConfirmBeep();
      await delay(120);
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

  const scheduleCommandSilenceTimeout = () => {
    clearCommandSilenceTimeout();
    const now = Date.now();
    const hasTranscript = Boolean(commandTranscriptRef.current.trim());
    const commandStartedAt = commandStartedAtRef.current || now;
    const lastSpeechAt = commandLastResultAtRef.current || commandStartedAt;
    const deadline = Math.min(
      commandStartedAt + MAX_COMMAND_DURATION_MS,
      hasTranscript ? lastSpeechAt + COMMAND_SILENCE_TIMEOUT_MS : commandStartedAt + EMPTY_COMMAND_TIMEOUT_MS
    );

    commandSilenceTimeoutRef.current = setTimeout(() => {
      if (commandTranscriptRef.current.trim()) {
        finalizeCurrentCommand("silence");
      } else {
        completeWithoutReply("Geen duidelijke melding gehoord. Probeer het nog eens.");
      }
    }, Math.max(200, deadline - now));
  };

  const startWakeRecognition = async () => {
    if (
      mode !== "main" ||
      !voiceLifecycleActiveRef.current ||
      appStateRef.current !== "active" ||
      isAnalyzingRef.current ||
      isDeliveringResponseRef.current
    ) {
      return;
    }

    if (wakeStartPromiseRef.current) {
      return wakeStartPromiseRef.current;
    }

    wakeStartPromiseRef.current = (async () => {
      clearWakeRestart();
      invalidateActiveTurn();
      resetTurnState();
      updateMainPhase("wake");
      setAnalysis(null);
      setAnalysisStatus("");
      setWakeRecognizerReady(false);
      wakeSessionStartedAtRef.current = Date.now();

      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          throw new Error("Spraakherkenning is niet beschikbaar op deze iPhone.");
        }

        const recognitionState = await ExpoSpeechRecognitionModule.getStateAsync();
        if (recognitionState !== "inactive") {
          await stopRecognitionSession();
        }
        if (
          !voiceLifecycleActiveRef.current ||
          appStateRef.current !== "active" ||
          mainPhaseRef.current !== "wake"
        ) {
          return;
        }
        await setListeningAudioMode();
        if (
          !voiceLifecycleActiveRef.current ||
          appStateRef.current !== "active" ||
          mainPhaseRef.current !== "wake"
        ) {
          return;
        }
        ExpoSpeechRecognitionModule.start({
          lang: "nl-NL",
          interimResults: true,
          continuous: true,
          addsPunctuation: false,
          // supportsOnDeviceRecognition() checks the device's default locale, not nl-NL.
          // Network recognition is the reliable fallback when the Dutch model is not installed.
          requiresOnDeviceRecognition: false,
          iosTaskHint: "search",
          iosCategory: {
            category: "playAndRecord",
            categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
            mode: "measurement"
          },
          contextualStrings: [
            "Hey CarTalk",
            "Hey Car Talk",
            "CarTalk",
            "car talk",
            "cartalk",
            "kaartalk",
            "kar talk",
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
      } catch (error) {
        wakeSessionStartedAtRef.current = 0;
        setWakeRecognizerReady(false);
        setAnalysisStatus(
          error instanceof Error ? error.message : "CarTalk kon de spraakactivatie niet starten."
        );
        if (voiceLifecycleActiveRef.current && appStateRef.current === "active") {
          restartWakeAfterDelay(900);
        }
      }
    })().finally(() => {
      wakeStartPromiseRef.current = null;
    });

    return wakeStartPromiseRef.current;
  };

  const startCommandRecognition = async ({ playActivationBeep = true } = {}) => {
    clearWakeRestart();
    clearCommandStart();
    if (!activeTurnIdRef.current) {
      startNewTurn(commandTranscriptRef.current.trim());
    }
    const turnId = activeTurnIdRef.current;
    pendingCommandStartRef.current = true;
    updateMainPhase("listening");
    setAnalysisStatus("CarTalk luistert...");
    setSpeechLevel(commandTranscriptRef.current.trim() ? -6 : -60);
    resetLivePlayback();

    await stopRecognitionSession();
    if (!isCurrentTurn(turnId) || mainPhaseRef.current !== "listening") {
      pendingCommandStartRef.current = false;
      return;
    }

    try {
      await setListeningAudioMode();
      if (playActivationBeep) {
        beepPlayer.volume = 1;
        beepPlayer.pause();
        await beepPlayer.seekTo(0);
        beepPlayer.play();
        await delay(260);
      }
      if (!isCurrentTurn(turnId) || mainPhaseRef.current !== "listening") {
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: "nl-NL",
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        iosTaskHint: "dictation",
        iosCategory: {
          category: "playAndRecord",
          categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
          mode: "measurement"
        },
        contextualStrings: [
          "kenteken",
          "verlichting uit",
          "achterlicht kapot",
          "band zacht",
          "deur open",
          "klep open",
          "links blijven rijden",
          "links plakken",
          "zwarte Volvo",
          "grijze Mercedes",
          "stop CarTalk",
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
      scheduleCommandSilenceTimeout();
    } catch (error) {
      if (isCurrentTurn(turnId)) {
        markTurnFailed(
          error instanceof Error ? error.message : "CarTalk kon niet verder luisteren."
        );
      }
    } finally {
      pendingCommandStartRef.current = false;
    }
  };

  const resumeCommandRecognition = () => {
    if (
      mainPhaseRef.current !== "listening" ||
      pendingCommandStartRef.current ||
      !activeTurnIdRef.current
    ) {
      return;
    }

    const elapsed = Date.now() - (commandStartedAtRef.current || Date.now());
    if (elapsed >= MAX_COMMAND_DURATION_MS) {
      if (commandTranscriptRef.current.trim()) {
        finalizeCurrentCommand("silence");
      } else {
        completeWithoutReply("Geen duidelijke melding gehoord. Probeer het nog eens.");
      }
      return;
    }

    scheduleCommandSilenceTimeout();
    pendingCommandStartRef.current = true;
    clearCommandStart();
    commandStartTimeoutRef.current = setTimeout(() => {
      void startCommandRecognition({ playActivationBeep: false });
    }, 220);
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
        const spoken = await withTimeout(
          requestLiveSpokenAlert(spokenPrompt, state.voiceOutputStyle),
          35_000,
          "Gemini-audio duurde te lang om te laden."
        );
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
      const recipientResolution = nextAnalysis.applicable
        ? await withTimeout(
            resolveRecipientForAnalysis(
              nextAnalysis,
              state.vehicleProfile,
              currentLocationRef.current,
              state.userId
            ),
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
        (finalRecipientResolution.lookupSource === "firebase" ||
          finalRecipientResolution.lookupSource === "hosted")
      ) {
        const recipientUserId = finalRecipientResolution.userId || "";
        const recipientIsReachable =
          Boolean(recipientUserId) &&
          recipientUserId !== state.userId &&
          finalRecipientResolution.isOnline !== false;

        if (recipientIsReachable) {
          try {
            const deliveryPayload = {
                senderUserId: state.userId,
                receiverOutput: nextAnalysis.receiverOutput || spokenReply,
                senderVehicleLabel: describeVehicleProfile(state.vehicleProfile),
                createdAt: Date.now()
              };
            const sendDelivery =
              finalRecipientResolution.lookupSource === "firebase"
                ? sendLiveDelivery(recipientUserId, deliveryPayload)
                : sendHostedDelivery(recipientUserId, deliveryPayload);
            await withTimeout(
              sendDelivery,
              5_000,
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
      if (isCurrentTurn(turnId)) {
        markTurnFailed(toAnalysisFailureMessage(error));
      }
    } finally {
      clearLiveProcessingTimeout();
      updateAnalyzing(false);
    }
  };

  useSpeechRecognitionEvent("start", () => {
    if (mode === "main" && mainPhaseRef.current === "wake") {
      wakeSessionStartedAtRef.current = Date.now();
      wakeRestartAttemptRef.current = 0;
      setWakeRecognizerReady(true);
      setAnalysisStatus("");
      console.info("[CarTalk] Wake recognizer ready");
    }
  });

  useSpeechRecognitionEvent("end", () => {
    if (mode !== "main") {
      return;
    }

    if (Date.now() < ignoreRecognitionEndUntilRef.current) {
      return;
    }

    setWakeRecognizerReady(false);
    wakeSessionStartedAtRef.current = 0;

    if (pendingCommandStartRef.current) {
      return;
    }

    if (mainPhaseRef.current === "wake" && !isAnalyzingRef.current && !isDeliveringResponseRef.current) {
      if (appStateRef.current === "active") {
        console.info("[CarTalk] Wake recognizer ended; restarting");
        scheduleWakeRestart(350);
      }
      return;
    }

    if (
      mainPhaseRef.current === "listening" &&
      !isAnalyzingRef.current &&
      !isDeliveringResponseRef.current
    ) {
      resumeCommandRecognition();
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
      const wakeMatched = includesWakePhrase(combinedWakeTranscript || latestTranscript);
      console.info("[CarTalk] Wake transcript received", {
        matched: wakeMatched,
        segmentCount: wakeTranscriptBufferRef.current.length
      });

      if (wakeMatched) {
        onActivateDrivingMode();
        startNewTurn(stripWakePhrase(combinedWakeTranscript || latestTranscript));
        void startCommandRecognition();
      }

      return;
    }

    if (mainPhaseRef.current === "listening") {
      const nextTranscript = extractBestTranscript(event.results);
      setSpeechLevel(-6);
      commandLastResultAtRef.current = Date.now();

      if (includesSubmitCommand(nextTranscript)) {
        commandTranscriptRef.current = mergeTranscriptSnapshot(
          commandTranscriptRef.current,
          stripSubmitCommand(nextTranscript)
        );
        finalizeCurrentCommand("submit");
        return;
      }

      commandTranscriptRef.current = mergeTranscriptSnapshot(commandTranscriptRef.current, nextTranscript);
      scheduleCommandSilenceTimeout();
    }
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    const mapped = Math.max(-60, Math.min(0, event.value * 6 - 60));
    setSpeechLevel(mapped);
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") {
      return;
    }

    console.warn("[CarTalk] Speech recognizer error", {
      phase: mainPhaseRef.current,
      code: event.error,
      nativeCode: event.code ?? null
    });
    setWakeRecognizerReady(false);
    wakeSessionStartedAtRef.current = 0;

    if (event.error === "no-speech" || event.error === "speech-timeout") {
      if (mode === "main") {
        if (mainPhaseRef.current === "listening") {
          resumeCommandRecognition();
        } else if (appStateRef.current === "active") {
          restartWakeAfterDelay(350);
        }
      }
      return;
    }

    if (
      event.error === "service-not-allowed" ||
      event.error === "not-allowed" ||
      event.error === "language-not-supported"
    ) {
      setAnalysisStatus(
        event.message || "Spraakactivatie heeft toegang tot de microfoon en spraakherkenning nodig."
      );
      return;
    }

    if (mode === "main" && mainPhaseRef.current === "wake" && appStateRef.current === "active") {
      wakeRestartAttemptRef.current += 1;
      const restartDelay = Math.min(3_000, 450 * wakeRestartAttemptRef.current);
      setAnalysisStatus("CarTalk herstart spraakactivatie...");
      restartWakeAfterDelay(restartDelay);
      return;
    }

    if (mode === "main" && mainPhaseRef.current === "listening") {
      resumeCommandRecognition();
      return;
    }

    setAnalysisStatus(event.message || "Spraakherkenning mislukt.");
  });

  useEffect(() => {
    let cancelled = false;
    voiceLifecycleActiveRef.current = true;
    appStateRef.current = AppState.currentState;

    const appStateSubscription =
      mode === "main"
        ? AppState.addEventListener("change", (nextState) => {
            appStateRef.current = nextState;

            if (nextState !== "active") {
              console.info("[CarTalk] Voice lifecycle suspended", { appState: nextState });
              clearWakeRestart();
              setWakeRecognizerReady(false);
              wakeSessionStartedAtRef.current = 0;
              if (mainPhaseRef.current === "wake") {
                try {
                  ExpoSpeechRecognitionModule.abort();
                } catch {
                  // The watchdog will restore the session when the app becomes active.
                }
              }
              return;
            }

            if (
              mainPhaseRef.current === "wake" &&
              !isAnalyzingRef.current &&
              !isDeliveringResponseRef.current
            ) {
              console.info("[CarTalk] Voice lifecycle resumed");
              restartWakeAfterDelay(450);
            }
          })
        : null;

    const wakeWatchdog =
      mode === "main"
        ? setInterval(() => {
            if (
              cancelled ||
              appStateRef.current !== "active" ||
              mainPhaseRef.current !== "wake" ||
              isAnalyzingRef.current ||
              isDeliveringResponseRef.current ||
              wakeStartPromiseRef.current
            ) {
              return;
            }

            void ExpoSpeechRecognitionModule.getStateAsync()
              .then((recognitionState) => {
                if (cancelled || mainPhaseRef.current !== "wake" || appStateRef.current !== "active") {
                  return;
                }

                if (recognitionState === "recognizing") {
                  setWakeRecognizerReady(true);
                  return;
                }

                const startStalled =
                  recognitionState === "starting" &&
                  wakeSessionStartedAtRef.current > 0 &&
                  Date.now() - wakeSessionStartedAtRef.current > WAKE_START_STALL_TIMEOUT_MS;

                if (recognitionState === "inactive" || startStalled) {
                  console.info("[CarTalk] Wake watchdog restarting recognizer", {
                    recognitionState,
                    startStalled
                  });
                  restartWakeAfterDelay(0);
                }
              })
              .catch(() => {
                if (!cancelled && appStateRef.current === "active") {
                  restartWakeAfterDelay(500);
                }
              });
          }, WAKE_WATCHDOG_INTERVAL_MS)
        : null;

    void (async () => {
      try {
        if (mode === "main") {
          const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (cancelled) {
            return;
          }
          setMicPermission(permission.granted ? "granted" : "denied");
          if (!permission.granted) {
            setAnalysisStatus("Geef CarTalk toegang tot de microfoon en spraakherkenning.");
            return;
          }
          await startWakeRecognition();
          if (cancelled) {
            return;
          }
          void ensureRelayHealth({ surfaceFailure: true }).catch(() => {
            // The idle UI already gets a clearer status message via ensureRelayHealth.
          });

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

    const responsePlayerForCleanup = responsePlayerRef.current;
    return () => {
      cancelled = true;
      voiceLifecycleActiveRef.current = false;
      appStateSubscription?.remove();
      if (wakeWatchdog) {
        clearInterval(wakeWatchdog);
      }
      clearWakeRestart();
      clearCommandStart();
      clearCommandSilenceTimeout();
      clearLivePlaybackTimeout();
      clearLiveProcessingTimeout();
      clearOutcomeReset();
      Speech.stop();
      responsePlayerForCleanup.pause();
      void clearResponseAudioFile();
      if (mode === "main") {
        ExpoSpeechRecognitionModule.abort();
      }
    };
    // This effect owns the native voice session and must not restart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "main" || !state.userId) {
      return;
    }

    const locService = new DrivingLocationService();
    void locService.start(state.userId, ({ lat, lng }) => {
      currentLocationRef.current = { lat, lng };
    });

    return () => {
      void locService.stop(state.userId);
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
      const inboundDeliveryId = inboundDeliveryToAcknowledgeRef.current;
      if (inboundDeliveryId) {
        inboundDeliveryToAcknowledgeRef.current = null;
        handlingInboundDeliveryIdRef.current = null;
        void acknowledgeInboundDelivery(inboundDeliveryId).catch(() => {
          // The hosted queue keeps the delivery until a later successful acknowledgement.
        });
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
    // Player status drives this state machine; unstable callback identities must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    inboundDeliveryToAcknowledgeRef.current = nextDelivery.id;
    const turnId = startNewTurn("");
    queueFollowUpResponse(null, false);
    setAnalysisStatus("CarTalk ontvangt een veiligheidsmelding...");

    if (!isCurrentTurn(turnId)) {
      return;
    }
    speakLiveAlert(nextDelivery.receiverOutput, false, turnId);
    // Delivery playback starts only when this queue or screen mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingInboundDeliveries]);

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
