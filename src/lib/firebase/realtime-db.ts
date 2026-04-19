import {
  get,
  onChildAdded,
  onDisconnect,
  push,
  ref,
  remove,
  set
} from "firebase/database";
import { GeoFire } from "geofire";

import { getFirebaseRealtimeDb } from "@/lib/firebase/app";
import { InboundDelivery } from "@/types/app-state";

const GEOFIRE_PATH = "geofire";
const PRESENCE_PATH = "presence";
const DELIVERIES_PATH = "deliveries";

export type PresenceRecord = {
  userId: string;
  vehicleLabel: string;
  isOnline: boolean;
  updatedAt: number;
};

function getGeoFire() {
  const db = getFirebaseRealtimeDb();
  if (!db) return null;
  return new GeoFire(ref(db, GEOFIRE_PATH));
}

/**
 * Write the user's location to the GeoFire index and register an onDisconnect
 * cleanup so the entry is automatically removed if the device disconnects.
 */
export async function writeUserLocation(userId: string, lat: number, lng: number): Promise<void> {
  const db = getFirebaseRealtimeDb();
  if (!db) return;

  const geoFire = getGeoFire();
  if (!geoFire) return;

  await geoFire.set(userId, [lat, lng]);

  // Auto-delete on disconnect (covers crashes and force-quits)
  onDisconnect(ref(db, `${GEOFIRE_PATH}/${userId}`)).remove();
}

/** Remove the user's location entry (call on logout or driving mode off). */
export async function removeUserLocation(userId: string): Promise<void> {
  const geoFire = getGeoFire();
  if (!geoFire) return;
  await geoFire.remove(userId);
}

/** Return userIds of drivers within `radiusKm` of the given coordinate. */
export function queryNearbyUserIds(
  lat: number,
  lng: number,
  radiusKm = 0.5
): Promise<string[]> {
  return new Promise((resolve) => {
    const geoFire = getGeoFire();
    if (!geoFire) {
      resolve([]);
      return;
    }

    const nearby: string[] = [];
    const geoQuery = geoFire.query({ center: [lat, lng] as [number, number], radius: radiusKm });

    geoQuery.on("key_entered", (userId: string) => {
      nearby.push(userId);
    });

    geoQuery.on("ready", () => {
      geoQuery.cancel();
      resolve(nearby);
    });
  });
}

export async function setUserPresence(userId: string, vehicleLabel: string) {
  const db = getFirebaseRealtimeDb();
  if (!db) return;

  const presenceRef = ref(db, `${PRESENCE_PATH}/${userId}`);
  await set(presenceRef, {
    userId,
    vehicleLabel,
    isOnline: true,
    updatedAt: Date.now()
  } satisfies PresenceRecord);
  onDisconnect(presenceRef).remove();
}

export async function clearUserPresence(userId: string) {
  const db = getFirebaseRealtimeDb();
  if (!db) return;
  await remove(ref(db, `${PRESENCE_PATH}/${userId}`));
}

export async function getUserPresence(userId: string): Promise<PresenceRecord | null> {
  const db = getFirebaseRealtimeDb();
  if (!db) return null;

  const snapshot = await get(ref(db, `${PRESENCE_PATH}/${userId}`));
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.val();
  return {
    userId: String(data.userId || userId),
    vehicleLabel: String(data.vehicleLabel || ""),
    isOnline: Boolean(data.isOnline),
    updatedAt: Number(data.updatedAt || 0)
  };
}

export async function sendLiveDelivery(
  recipientUserId: string,
  payload: Omit<InboundDelivery, "id" | "recipientUserId"> & { recipientUserId?: string }
) {
  const db = getFirebaseRealtimeDb();
  if (!db) {
    throw new Error("Firebase realtime database is not configured");
  }

  const deliveriesRef = ref(db, `${DELIVERIES_PATH}/${recipientUserId}`);
  const nextRef = push(deliveriesRef);
  const messageId = nextRef.key;

  if (!messageId) {
    throw new Error("Kon geen live delivery-id maken.");
  }

  await set(nextRef, {
    id: messageId,
    senderUserId: payload.senderUserId,
    recipientUserId,
    receiverOutput: payload.receiverOutput,
    senderVehicleLabel: payload.senderVehicleLabel,
    createdAt: payload.createdAt
  } satisfies InboundDelivery);

  return messageId;
}

export function subscribeToLiveDeliveries(
  userId: string,
  onDelivery: (delivery: InboundDelivery) => void
) {
  const db = getFirebaseRealtimeDb();
  if (!db) {
    return () => {};
  }

  const deliveriesRef = ref(db, `${DELIVERIES_PATH}/${userId}`);
  const unsubscribe = onChildAdded(deliveriesRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      return;
    }

    onDelivery({
      id: String(data.id || snapshot.key || ""),
      senderUserId: String(data.senderUserId || ""),
      recipientUserId: String(data.recipientUserId || userId),
      receiverOutput: String(data.receiverOutput || ""),
      senderVehicleLabel: String(data.senderVehicleLabel || "Andere bestuurder"),
      createdAt: Number(data.createdAt || Date.now())
    });
  });

  return unsubscribe;
}

export async function acknowledgeLiveDelivery(userId: string, deliveryId: string) {
  const db = getFirebaseRealtimeDb();
  if (!db) return;
  await remove(ref(db, `${DELIVERIES_PATH}/${userId}/${deliveryId}`));
}
