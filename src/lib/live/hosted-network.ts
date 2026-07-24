import { RecordingAnalysis } from "@/lib/live/recording-analysis";
import { getRelayHttpBaseUrl } from "@/lib/live/relay-host";
import { InboundDelivery, VehicleProfile } from "@/types/app-state";

const DEFAULT_NETWORK_TIMEOUT_MS = 8_000;
const COLD_START_TIMEOUT_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 12_000;

async function requestHosted<T>(
  path: string,
  init: RequestInit,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getRelayHttpBaseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers
      },
      signal: controller.signal
    });
    const data = (await response.json()) as T & { ok?: boolean; error?: string };
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `CarTalk cloud request failed (${response.status}).`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function setHostedPresence(
  userId: string,
  vehicle: VehicleProfile,
  vehicleLabel: string
) {
  await requestHosted("/presence", {
    method: "POST",
    body: JSON.stringify({ userId, vehicle, vehicleLabel })
  }, COLD_START_TIMEOUT_MS);
}

export async function clearHostedPresence(userId: string) {
  await requestHosted("/presence/offline", {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}

export async function resolveHostedRecipient(
  senderUserId: string,
  analysis: RecordingAnalysis
) {
  const data = await requestHosted<{
    ok: boolean;
    recipient: { userId: string; vehicleLabel: string; isOnline: boolean } | null;
  }>("/resolve-recipient", {
    method: "POST",
    body: JSON.stringify({
      senderUserId,
      transcript: analysis.transcript,
      targetDescription: analysis.targetDescription
    })
  }, DELIVERY_TIMEOUT_MS);
  return data.recipient;
}

export async function sendHostedDelivery(
  recipientUserId: string,
  payload: Omit<InboundDelivery, "id" | "recipientUserId">
) {
  const data = await requestHosted<{ ok: boolean; deliveryId: string }>("/deliver", {
    method: "POST",
    body: JSON.stringify({
      recipientUserId,
      ...payload
    })
  }, DELIVERY_TIMEOUT_MS);
  return data.deliveryId;
}

export async function pollHostedDeliveries(userId: string) {
  const data = await requestHosted<{ ok: boolean; deliveries: InboundDelivery[] }>(
    `/deliveries?userId=${encodeURIComponent(userId)}`,
    { method: "GET", headers: {} }
  );
  return data.deliveries;
}

export async function acknowledgeHostedDelivery(userId: string, deliveryId: string) {
  await requestHosted("/deliveries/ack", {
    method: "POST",
    body: JSON.stringify({ userId, deliveryId })
  });
}
