import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where
} from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase/app";

type FirestoreVehicleRecord = {
  userId?: string;
  country: "NL";
  plateDisplay: string;
  plateNormalized: string;
  brand: string;
  vehicleType: string;
  color: string;
};

const VEHICLES_COLLECTION = "vehicles";

export async function saveVehicleForUser(userId: string, vehicle: FirestoreVehicleRecord) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error("Firebase is not configured");
  }

  await setDoc(doc(db, VEHICLES_COLLECTION, `${userId}_${vehicle.plateNormalized}`), {
    userId,
    country: vehicle.country,
    plateDisplay: vehicle.plateDisplay,
    plateNormalized: vehicle.plateNormalized,
    brand: vehicle.brand,
    vehicleType: vehicle.vehicleType,
    color: vehicle.color,
    verificationStatus: "self-declared",
    isPrimary: true,
    createdAt: serverTimestamp()
  });
}

export async function findVehiclesForUser(userId: string) {
  const db = getFirebaseDb();
  if (!db) return [];

  const vehicleQuery = query(
    collection(db, VEHICLES_COLLECTION),
    where("userId", "==", userId),
    limit(5)
  );

  const snapshot = await getDocs(vehicleQuery);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      userId: data.userId as string,
      country: data.country as "NL",
      plateDisplay: (data.plateDisplay as string) || "",
      plateNormalized: (data.plateNormalized as string) || "",
      brand: (data.brand as string) || "",
      vehicleType: (data.vehicleType as string) || "",
      color: (data.color as string) || ""
    };
  });
}

export async function findVehicleRecordByPlate(plateNormalized: string) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error("Firebase is not configured");
  }

  const vehicleQuery = query(
    collection(db, VEHICLES_COLLECTION),
    where("plateNormalized", "==", plateNormalized),
    limit(1)
  );

  const snapshot = await getDocs(vehicleQuery);

  if (snapshot.empty) {
    return null;
  }

  const data = snapshot.docs[0].data();

  return {
    userId: data.userId as string,
    country: data.country as "NL",
    plateDisplay: data.plateDisplay as string,
    plateNormalized: data.plateNormalized as string,
    brand: (data.brand as string) || "",
    vehicleType: (data.vehicleType as string) || "",
    color: (data.color as string) || ""
  };
}
