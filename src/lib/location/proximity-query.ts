import { findVehicleRecordByPlate, findVehiclesForUser } from "@/lib/firebase/firestore-vehicles";
import { queryNearbyUserIds } from "@/lib/firebase/realtime-db";
import { normalizeDutchPlate } from "@/features/vehicles/normalize-dutch-plate";
import type { MatchCandidate } from "@/lib/matching/recipient-matcher";

/** Minimum normalized plate length to be treated as a plate lookup. */
const MIN_PLATE_LENGTH = 5;

function looksLikePlate(target: string): boolean {
  return normalizeDutchPlate(target).length >= MIN_PLATE_LENGTH;
}

function vehicleToCandidate(
  userId: string,
  v: { plateDisplay: string; brand: string; color: string; vehicleType: string }
): MatchCandidate {
  return {
    id: userId,
    label: [v.color, v.brand, v.vehicleType].filter(Boolean).join(" "),
    plate: v.plateDisplay,
    brand: v.brand,
    color: v.color,
    vehicleType: v.vehicleType
  };
}

/**
 * Resolve a Gemini-extracted target string into a list of match candidates.
 *
 * Branch 1 — plate: direct Firestore lookup, no location needed.
 * Branch 2 — description: GeoFire query at 500 m, then fetch vehicle profiles.
 */
export async function resolveRecipients(
  target: string,
  location: { lat: number; lng: number } | null
): Promise<MatchCandidate[]> {
  // Branch 1: target looks like a Dutch plate
  if (looksLikePlate(target)) {
    const plateNormalized = normalizeDutchPlate(target);
    const vehicle = await findVehicleRecordByPlate(plateNormalized);
    if (!vehicle) return [];
    return [vehicleToCandidate(plateNormalized, vehicle)];
  }

  // Branch 2: fuzzy description — needs GPS location
  if (!location) return [];

  const nearbyUserIds = await queryNearbyUserIds(location.lat, location.lng);
  if (nearbyUserIds.length === 0) return [];

  const vehicleLists = await Promise.all(nearbyUserIds.map((uid) => findVehiclesForUser(uid)));

  const candidates: MatchCandidate[] = [];
  for (let i = 0; i < nearbyUserIds.length; i++) {
    const uid = nearbyUserIds[i] ?? "";
    const vehicles = vehicleLists[i] ?? [];
    for (const v of vehicles) {
      candidates.push(vehicleToCandidate(uid, v));
    }
  }

  return candidates;
}
