const PRESENCE_TTL_MS = 60_000;
const DELIVERY_TTL_MS = 10 * 60_000;
const MAX_PRESENCES = 500;
const MAX_DELIVERIES_PER_USER = 50;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cleanVehicle(vehicle = {}) {
  return {
    plate: String(vehicle.plate || "").slice(0, 16),
    brand: String(vehicle.brand || "").trim().slice(0, 40),
    vehicleType: String(vehicle.vehicleType || "").trim().slice(0, 40),
    color: String(vehicle.color || "").trim().slice(0, 40)
  };
}

function describeVehicle(vehicle, fallback = "Andere bestuurder") {
  const label = [vehicle.color, vehicle.brand, vehicle.vehicleType]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return label || (vehicle.plate ? `Voertuig ${vehicle.plate}` : fallback);
}

function extractPlateCandidates(value) {
  const matches = String(value || "").match(/\b[A-Z0-9]{1,3}(?:[-\s]?[A-Z0-9]{1,3}){1,2}\b/gi) || [];
  return Array.from(
    new Set(matches.map(normalizePlate).filter((plate) => plate.length >= 5 && /\d/.test(plate)))
  );
}

function scorePresence(searchText, plateCandidates, presence) {
  const vehicle = presence.vehicle;
  const plate = normalizePlate(vehicle.plate);
  let score = plate && plateCandidates.includes(plate) ? 12 : 0;

  const parts = [
    [vehicle.brand, 4],
    [vehicle.color, 3],
    [vehicle.vehicleType, 2]
  ];

  for (const [value, weight] of parts) {
    const normalized = normalizeText(value);
    if (normalized && searchText.includes(normalized)) {
      score += weight;
    }
  }

  const fullLabel = normalizeText(presence.vehicleLabel);
  if (fullLabel && searchText.includes(fullLabel)) {
    score += 5;
  }

  return score;
}

export function createDemoNetworkStore() {
  const presences = new Map();
  const deliveries = new Map();

  function prune(now = Date.now()) {
    for (const [userId, presence] of presences) {
      if (now - presence.updatedAt > PRESENCE_TTL_MS) {
        presences.delete(userId);
      }
    }

    for (const [userId, queue] of deliveries) {
      const current = queue.filter((delivery) => now - delivery.createdAt <= DELIVERY_TTL_MS);
      if (current.length) {
        deliveries.set(userId, current);
      } else {
        deliveries.delete(userId);
      }
    }
  }

  return {
    setPresence({ userId, vehicle, vehicleLabel }) {
      prune();
      const cleanUserId = String(userId || "").trim().slice(0, 120);
      if (!cleanUserId) {
        throw new Error("Missing userId");
      }

      const cleanProfile = cleanVehicle(vehicle);
      const presence = {
        userId: cleanUserId,
        vehicle: cleanProfile,
        vehicleLabel:
          String(vehicleLabel || "").trim().slice(0, 120) ||
          describeVehicle(cleanProfile),
        updatedAt: Date.now()
      };
      presences.set(cleanUserId, presence);
      if (presences.size > MAX_PRESENCES) {
        const oldest = [...presences.values()].sort(
          (left, right) => left.updatedAt - right.updatedAt
        )[0];
        if (oldest && oldest.userId !== cleanUserId) {
          presences.delete(oldest.userId);
        }
      }
      return presence;
    },

    clearPresence(userId) {
      presences.delete(String(userId || ""));
    },

    resolveRecipient({ senderUserId, transcript, targetDescription }) {
      prune();
      const candidates = Array.from(presences.values()).filter(
        (presence) => presence.userId !== String(senderUserId || "")
      );

      if (!candidates.length) {
        return null;
      }

      const source = `${targetDescription || ""} ${transcript || ""}`;
      const searchText = normalizeText(source);
      const plateCandidates = extractPlateCandidates(source);
      const scored = candidates
        .map((presence) => ({
          presence,
          score: scorePresence(searchText, plateCandidates, presence)
        }))
        .sort((left, right) => right.score - left.score);

      const best = scored[0];
      if (!best || (best.score < 2 && candidates.length !== 1)) {
        return null;
      }

      return {
        userId: best.presence.userId,
        vehicleLabel: best.presence.vehicleLabel,
        isOnline: true
      };
    },

    sendDelivery({ recipientUserId, senderUserId, receiverOutput, senderVehicleLabel }) {
      prune();
      const cleanRecipientId = String(recipientUserId || "");
      if (!presences.has(cleanRecipientId)) {
        return null;
      }

      const delivery = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        senderUserId: String(senderUserId || ""),
        recipientUserId: cleanRecipientId,
        receiverOutput: String(receiverOutput || "").trim().slice(0, 500),
        senderVehicleLabel: String(senderVehicleLabel || "Andere bestuurder").trim().slice(0, 120),
        createdAt: Date.now()
      };
      const queue = deliveries.get(cleanRecipientId) || [];
      deliveries.set(
        cleanRecipientId,
        [...queue, delivery].slice(-MAX_DELIVERIES_PER_USER)
      );
      return delivery;
    },

    listDeliveries(userId) {
      prune();
      return [...(deliveries.get(String(userId || "")) || [])];
    },

    acknowledgeDelivery(userId, deliveryId) {
      const cleanUserId = String(userId || "");
      const queue = deliveries.get(cleanUserId) || [];
      deliveries.set(
        cleanUserId,
        queue.filter((delivery) => delivery.id !== String(deliveryId || ""))
      );
    },

    getPresenceCount() {
      prune();
      return presences.size;
    }
  };
}
