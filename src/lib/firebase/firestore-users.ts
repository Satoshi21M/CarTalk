import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase/app";
import { Provider } from "@/types/app-state";

export type FirestoreUserProfile = {
  id: string;
  provider: Exclude<Provider, null>;
  country: "NL";
  language: "Dutch";
  createdAt?: unknown;
  updatedAt?: unknown;
};

const USERS_COLLECTION = "users";

export async function saveUserProfile(profile: FirestoreUserProfile) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error("Firebase is not configured");
  }

  const ref = doc(db, USERS_COLLECTION, profile.id);

  await setDoc(
    ref,
    {
      ...profile,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function getUserProfile(userId: string) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error("Firebase is not configured");
  }

  const snapshot = await getDoc(doc(db, USERS_COLLECTION, userId));

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();

  return {
    id: snapshot.id,
    provider: data.provider as Exclude<Provider, null>,
    country: data.country as "NL",
    language: data.language as "Dutch"
  };
}
