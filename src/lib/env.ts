import { firebaseConfig } from "@/lib/firebase/config";

type EnvCheck = {
  valid: boolean;
  missing: string[];
};

const envEntries = [
  ["EXPO_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["EXPO_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", firebaseConfig.storageBucket],
  ["EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", firebaseConfig.messagingSenderId],
  ["EXPO_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId]
] as const;

export function getFirebaseEnvCheck(): EnvCheck {
  const missing = envEntries.filter(([, value]) => !value).map(([key]) => key);

  return {
    valid: missing.length === 0,
    missing
  };
}

