import { getUserPresence } from "@/lib/firebase/realtime-db";
import { resolveRecipients } from "@/lib/location/proximity-query";
import { matchRecipient } from "@/lib/matching/recipient-matcher";
import { normalizeDutchPlate } from "@/features/vehicles/normalize-dutch-plate";
import { resolveHostedRecipient } from "@/lib/live/hosted-network";
import { RecordingAnalysis } from "@/lib/live/recording-analysis";
import { getServiceMode } from "@/lib/services/service-mode";
import { getVehicleService, RegisteredVehicle } from "@/lib/services/vehicle-service";
import { VehicleProfile } from "@/types/app-state";

export type RecipientResolution =
  | {
      status: "found";
      userId?: string;
      vehicleLabel: string;
      isOnline?: boolean;
      lookupSource: "firebase" | "hosted";
    }
  | {
      status: "not_found";
      vehicleHint: string | null;
    };

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function describeVehicleParts(parts: (string | null | undefined)[]) {
  const cleanParts = parts.map((part) => String(part || "").trim()).filter(Boolean);
  return cleanParts.length ? cleanParts.join(" ") : "";
}

function describeVehicleRecord(vehicle: Pick<RegisteredVehicle, "plateDisplay" | "brand" | "color" | "vehicleType">) {
  const descriptive = describeVehicleParts([
    vehicle.color ? toTitleCase(vehicle.color) : "",
    vehicle.brand ? toTitleCase(vehicle.brand) : "",
    vehicle.vehicleType ? toTitleCase(vehicle.vehicleType) : ""
  ]);

  if (descriptive) {
    return descriptive;
  }

  return vehicle.plateDisplay ? `Voertuig met kenteken ${vehicle.plateDisplay}` : "Andere bestuurder";
}

function extractPlateCandidates(text: string) {
  const rawMatches = text.match(/\b[A-Z0-9]{1,3}(?:[-\s]?[A-Z0-9]{1,3}){1,2}\b/gi) || [];

  return Array.from(
    new Set(
      rawMatches
        .map((candidate) => normalizeDutchPlate(candidate))
        .filter((candidate) => candidate.length >= 5 && /\d/.test(candidate))
    )
  );
}

function buildVehicleHint(analysis: RecordingAnalysis) {
  const hint = String(analysis.targetDescription || "").trim();
  if (hint) {
    return hint;
  }

  const transcript = normalizeText(analysis.transcript || "");
  if (!transcript) {
    return null;
  }

  const snippets = transcript
    .replace(/^hey cartalk\s*/i, "")
    .replace(/\b(verzend|verstuur|send)\b.*$/i, "")
    .trim();

  return snippets || null;
}

async function resolveFirebaseRecipient(
  analysis: RecordingAnalysis,
  location: { lat: number; lng: number } | null
) {
  if (getServiceMode() !== "firebase") {
    return null;
  }

  const searchText = `${analysis.targetDescription || ""} ${analysis.transcript || ""}`;
  const candidatePlates = extractPlateCandidates(searchText);

  for (const plate of candidatePlates) {
    const foundVehicle = await getVehicleService().findVehicleByPlate(plate);
    if (foundVehicle) {
      const presence = foundVehicle.userId ? await getUserPresence(foundVehicle.userId) : null;
      return {
        status: "found" as const,
        userId: foundVehicle.userId,
        vehicleLabel: describeVehicleRecord(foundVehicle),
        isOnline: Boolean(presence?.isOnline),
        lookupSource: "firebase" as const
      };
    }
  }

  const target = String(analysis.targetDescription || analysis.transcript || "").trim();
  if (!target || !location) {
    return null;
  }

  const candidates = await resolveRecipients(target, location);
  const matched = matchRecipient(target, candidates);
  if (!matched) {
    return null;
  }

  const presence = await getUserPresence(matched.id);
  return {
    status: "found" as const,
    userId: matched.id,
    vehicleLabel: describeVehicleParts([
      toTitleCase(matched.color),
      toTitleCase(matched.brand),
      toTitleCase(matched.vehicleType)
    ]) || matched.label || "Andere bestuurder",
    isOnline: Boolean(presence?.isOnline),
    lookupSource: "firebase" as const
  };
}

export async function resolveRecipientForAnalysis(
  analysis: RecordingAnalysis,
  _localVehicleProfile: VehicleProfile,
  location: { lat: number; lng: number } | null = null,
  senderUserId: string = ""
): Promise<RecipientResolution> {
  if (!analysis.applicable) {
    return {
      status: "not_found",
      vehicleHint: null
    };
  }

  const firebaseRecipient = await resolveFirebaseRecipient(analysis, location);
  if (firebaseRecipient) {
    return firebaseRecipient;
  }

  if (getServiceMode() !== "firebase" && senderUserId) {
    const hostedRecipient = await resolveHostedRecipient(senderUserId, analysis);
    if (hostedRecipient) {
      return {
        status: "found",
        userId: hostedRecipient.userId,
        vehicleLabel: hostedRecipient.vehicleLabel,
        isOnline: hostedRecipient.isOnline,
        lookupSource: "hosted"
      };
    }
  }

  return {
    status: "not_found",
    vehicleHint: buildVehicleHint(analysis)
  };
}

function toVehicleReference(vehicleHint: string | null) {
  if (!vehicleHint) {
    return "deze melding";
  }

  const trimmed = vehicleHint.trim();
  const startsWithArticle = /^(de|het|een)\b/i.test(trimmed);
  return startsWithArticle ? trimmed : `de ${trimmed}`;
}

export function buildSpokenSenderReply(analysis: RecordingAnalysis) {
  if (!analysis.applicable) {
    return "Dit is geen veiligheidsmelding.";
  }

  return analysis.receiverOutput || analysis.senderReply || "Een verkeersmelding is doorgegeven.";
}

export function buildDeliveryConfirmationReply(
  analysis: RecordingAnalysis,
  recipient: RecipientResolution,
  confirmationsEnabled: boolean
) {
  if (!analysis.applicable || !confirmationsEnabled) {
    return null;
  }

  if (recipient.status === "found") {
    if (recipient.isOnline === false) {
      return `${recipient.vehicleLabel} is nu niet bereikbaar in CarTalk.`;
    }
    return `${recipient.vehicleLabel} heeft uw bericht ontvangen.`;
  }

  return `Ik kon nog geen CarTalk-gebruiker vinden voor ${toVehicleReference(recipient.vehicleHint)}.`;
}

export function shouldShowSentSuccess(analysis: RecordingAnalysis, recipient: RecipientResolution, confirmationsEnabled: boolean) {
  if (!analysis.applicable) {
    return false;
  }

  if (!confirmationsEnabled) {
    return recipient.status === "found" ? recipient.isOnline !== false : false;
  }

  return recipient.status === "found" && recipient.isOnline !== false;
}
