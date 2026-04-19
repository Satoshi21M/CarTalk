import { GoogleGenAI, createPartFromBase64, createPartFromText } from "@google/genai";

import { assertGeminiServerConfig, getServerConfig } from "./config.mjs";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesLaneBlockingSafety(transcript) {
  const normalized = normalizeText(transcript);

  const directPatterns = [
    /\blinks plakken\b/,
    /\bonnodig links\b/,
    /\blinks blijven rijden\b/,
    /\bleft lane hogging\b/,
    /\bleft lane blocking\b/,
    /\bblokkeert de linkerbaan\b/,
    /\bleft lane\b/
  ];

  if (directPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const laneWords = /\b(linkerbaan|linker rijstrook|links)\b/.test(normalized);
  const passingIntent = /\b(ik wil eromheen|ik wil erlangs|ik wil voorbij|ik wil passeren|ik kom er niet langs|kan er niet langs|won t let me pass|wont let me pass|i want to get around|i want to pass)\b/.test(
    normalized
  );
  const stickingLeft = /\b(blijft links|blijft links hangen|blijft links rijden|rijdt links|hangt links)\b/.test(normalized);

  return (laneWords && passingIntent) || stickingLeft;
}

function extractSection(text, label) {
  // Match both plain "LABEL: value" and markdown-wrapped "**LABEL:** value"
  const pattern = new RegExp(`(?:^|\\n)\\*{0,2}${label}\\*{0,2}:[ \\t]*(.*)$`, "im");
  const match = text.match(pattern);
  return match?.[1]?.trim() || "";
}

function inferTargetDescription(transcript) {
  const normalized = normalizeText(transcript);
  const plateCandidates = transcript.match(/\b[A-Z0-9]{1,3}(?:[-\s]?[A-Z0-9]{1,3}){1,2}\b/gi) || [];
  const plateMatch =
    plateCandidates.find((candidate) => /\d/.test(candidate) && candidate.replace(/[^A-Z0-9]/gi, "").length >= 5) || null;
  const colorMatch = normalized.match(
    /\b(zwart|zwarte|wit|witte|grijs|grijze|rood|rode|blauw|blauwe|groen|groene|geel|gele|zilver|zilveren|black|white|grey|gray|red|blue|green|yellow|silver)\b/
  );
  const brandMatch = normalized.match(
    /\b(volvo|bmw|mercedes|mercedes benz|mercedes-benz|audi|volkswagen|vw|tesla|toyota|peugeot|renault|opel|ford|kia|hyundai)\b/
  );
  const vehicleTypeMatch = normalized.match(
    /\b(sedan|stationwagen|station|wagon|suv|bestelwagen|bestelbus|van|bus|hatchback|coupe|truck)\b/
  );

  const parts = [colorMatch?.[0], brandMatch?.[0], vehicleTypeMatch?.[0], plateMatch]
    .filter(Boolean)
    .map((part) => String(part).trim());

  return parts.length ? parts.join(" ") : null;
}

function buildFallbackReceiverOutput(transcript) {
  const normalized = normalizeText(transcript);

  if (matchesLaneBlockingSafety(transcript)) {
    return "Een bestuurder vraagt u vriendelijk om rechts te houden als dat veilig kan.";
  }

  const rules = [
    {
      pattern: /\b(licht|lichten|headlight|headlights|lampen).*\buit\b|\b(lichten uit|lights off)\b/,
      output: "Een bestuurder heeft gemeld dat uw verlichting uit staat."
    },
    {
      pattern: /\b(achterlicht|taillight|rear light|remlicht).*\b(kapot|stuk|defect|broken)\b|\bkapot achterlicht\b/,
      output: "Een bestuurder heeft gemeld dat er mogelijk iets mis is met uw achterverlichting."
    },
    {
      pattern: /\b(flat tire|platte band|lekke band|zachte band|soft tire|tyre)\b/,
      output: "Een bestuurder heeft gemeld dat een van uw banden mogelijk niet in orde is."
    },
    {
      pattern: /\b(door|deur|klep|boot).*\b(open|los)\b/,
      output: "Een bestuurder heeft gemeld dat mogelijk een deur of klep niet goed gesloten is."
    },
    {
      pattern: /\b(slingert|swerving|zwalkt|weaving|gevaarlijk)\b/,
      output: "Een bestuurder heeft gemeld dat uw voertuig mogelijk onrustig over de weg beweegt."
    },
    {
      pattern: /\b(links plakken|onnodig links|left lane hogging|left lane blocking|left lane|links blijven rijden)\b/,
      output: "Een bestuurder vraagt u vriendelijk om rechts te houden als dat veilig kan."
    },
    {
      pattern: /\b(object|voorwerp|iets).*\b(weg|rijbaan|lane|road)\b/,
      output: "Een bestuurder heeft gemeld dat er iets gevaarlijks op de rijbaan ligt."
    }
  ];

  const matched = rules.find((rule) => rule.pattern.test(normalized));
  if (matched) {
    return matched.output;
  }

  return "Een bestuurder heeft een verkeers- of veiligheidsmelding doorgegeven.";
}

function buildFallbackSenderReply(applicable, transcript, receiverOutput) {
  if (applicable) {
    return receiverOutput || buildFallbackReceiverOutput(transcript);
  }

  const normalized = normalizeText(transcript);
  if (normalized.includes("hungry") || normalized.includes("honger")) {
    return "Dit is geen veiligheidsmelding.";
  }
  if (normalized.includes("weer") || normalized.includes("weather")) {
    return "Dit is geen veiligheidsmelding.";
  }

  return "Dit is geen veiligheidsmelding.";
}

function shouldUseFallbackSenderReply(applicable, senderReply) {
  if (applicable) {
    return false;
  }

  const normalized = normalizeText(senderReply);
  return !normalized || ["begrijp ik", "ok", "okay", "oke", "duidelijk"].includes(normalized);
}

function toAnalysisResponse(text) {
  const transcript = extractSection(text, "TRANSCRIPT") || text.trim();
  const laneBlockingRelevant = matchesLaneBlockingSafety(transcript);
  const applicableValue = extractSection(text, "APPLICABLE").toLowerCase();
  const applicable =
    applicableValue === "yes" || applicableValue === "true" || applicableValue === "ja" || laneBlockingRelevant;
  const reasonCategory =
    extractSection(text, "REASON_CATEGORY") ||
    (applicable ? "vehicle_safety" : "not_applicable");
  const normalizedReasonCategory = laneBlockingRelevant ? "dangerous_driving" : reasonCategory;
  const receiverOutput =
    extractSection(text, "RECEIVER_OUTPUT") || (applicable ? buildFallbackReceiverOutput(transcript) : "");
  const targetDescriptionRaw = extractSection(text, "TARGET_DESCRIPTION");
  const targetDescription =
    !applicable
      ? null
      : targetDescriptionRaw && normalizeText(targetDescriptionRaw) !== "unknown"
      ? targetDescriptionRaw
      : inferTargetDescription(transcript);
  const extractedSenderReply = extractSection(text, "SENDER_REPLY");
  const senderReply =
    !applicable
      ? buildFallbackSenderReply(false, transcript, "")
      : extractedSenderReply && !shouldUseFallbackSenderReply(applicable, extractedSenderReply)
      ? extractedSenderReply
      : buildFallbackSenderReply(applicable, transcript, receiverOutput);

  return {
    rawText: text,
    transcript,
    applicable,
    reasonCategory: normalizedReasonCategory,
    receiverOutput,
    targetDescription,
    senderReply
  };
}

function buildPrompt(incomingTranscript = "") {
  const transcriptLine = incomingTranscript ? `TRANSCRIPT_HINT: ${incomingTranscript}` : "";

  return [
    "You are CarTalk, a voice-first driving safety assistant.",
    "Your job is to decide whether the driver's spoken message is traffic- or safety-relevant.",
    "Relevant examples:",
    "- vehicle safety issues such as lights off, flat tire, open door, broken taillight",
    "- dangerous driving such as swerving, wrong behavior, distracted driving",
    "- lane-discipline warnings such as left-lane hogging, blocking traffic, or staying in the left lane unnecessarily",
    "- lane-discipline warnings phrased informally, such as someone driving left while others want to pass or get around them",
    "- road hazard/help such as debris on the road or urgent road-user warning",
    "Not relevant examples:",
    "- hunger, weather chat, jokes, casual conversation, entertainment",
    "- requests that are not about driving, road safety, or helping another road user",
    "Be balanced: allow clearly traffic-relevant content through, reject trivial or unrelated input.",
    "Input may be Dutch or English or mixed. The receiver output may use the most fitting language for the input/context.",
    "Return plain text in exactly this format:",
    "TRANSCRIPT: <cleaned-up transcript in the detected language>",
    "APPLICABLE: <yes or no>",
    "REASON_CATEGORY: <vehicle_safety|dangerous_driving|road_hazard|road_help|not_applicable>",
    "TARGET_DESCRIPTION: <vehicle or road-user description if present, otherwise unknown>",
    "RECEIVER_OUTPUT: <short polite message for the receiving road user; leave empty if not applicable>",
    "SENDER_REPLY: <if applicable, usually the same as RECEIVER_OUTPUT; if not applicable, a very short spoken rejection>",
    "Rules:",
    "- RECEIVER_OUTPUT must be concise, polite, and suitable for speech.",
    "- Keep RECEIVER_OUTPUT under roughly 18 words if possible.",
    "- Do not mention CarTalk in RECEIVER_OUTPUT.",
    "- For left-lane hogging or lane discipline, be subtle and friendly, not accusatory.",
    "- Treat 'someone is driving left and I want to get around them' as applicable dangerous driving / lane-discipline input.",
    "- Treat phrasing like 'ik wil eromheen', 'ik wil erlangs', 'hij blijft links hangen', and 'blocks the left lane' as applicable.",
    "- If the message is not applicable, RECEIVER_OUTPUT must be empty.",
    '- If the message says "I am hungry", asks for the weather, or asks for a joke, mark it not applicable.',
    transcriptLine
  ]
    .filter(Boolean)
    .join("\n");
}

function shouldRetryGeminiError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("\"status\":\"unavailable\"") ||
    message.includes("\"code\":503") ||
    message.includes("resource_exhausted") ||
    message.includes("\"code\":429") ||
    message.includes("rate limit")
  );
}

async function withGeminiRetry(task) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!shouldRetryGeminiError(error) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 550));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini analyse mislukte.");
}

async function generateCarTalkResponse(ai, model, parts, transcriptHint = "") {
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model,
      contents: [createPartFromText(buildPrompt(transcriptHint)), ...parts]
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini analysis returned no text. The model may have been rate-limited, blocked by safety filters, or returned an empty response.");
  }

  return toAnalysisResponse(text);
}

export async function analyzeRecordedAudio({ audioBase64, mimeType }) {
  const requiredConfig = assertGeminiServerConfig();
  const config = getServerConfig();
  const ai = new GoogleGenAI({ apiKey: requiredConfig.geminiApiKey });
  const parts = [createPartFromBase64(audioBase64, mimeType)];

  try {
    return await generateCarTalkResponse(ai, config.geminiAnalysisModel, parts, "");
  } catch (error) {
    if (
      config.geminiAnalysisFallbackModel &&
      config.geminiAnalysisFallbackModel !== config.geminiAnalysisModel &&
      shouldRetryGeminiError(error)
    ) {
      return generateCarTalkResponse(ai, config.geminiAnalysisFallbackModel, parts, "");
    }

    throw error;
  }
}

export async function analyzeDriverTranscript({ transcript }) {
  const requiredConfig = assertGeminiServerConfig();
  const config = getServerConfig();
  const ai = new GoogleGenAI({ apiKey: requiredConfig.geminiApiKey });
  const parts = [createPartFromText(`DRIVER_MESSAGE: ${transcript}`)];

  try {
    return await generateCarTalkResponse(ai, config.geminiAnalysisModel, parts, transcript);
  } catch (error) {
    if (
      config.geminiAnalysisFallbackModel &&
      config.geminiAnalysisFallbackModel !== config.geminiAnalysisModel &&
      shouldRetryGeminiError(error)
    ) {
      return generateCarTalkResponse(ai, config.geminiAnalysisFallbackModel, parts, transcript);
    }

    throw error;
  }
}
