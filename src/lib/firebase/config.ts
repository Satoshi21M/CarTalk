export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
  // TODO: set EXPO_PUBLIC_FIREBASE_DATABASE_URL to your Realtime Database URL
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ?? ""
};

export function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every(Boolean);
}

