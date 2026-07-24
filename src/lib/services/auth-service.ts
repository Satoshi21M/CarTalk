import { Provider } from "@/types/app-state";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signOut as firebaseSignOut
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/app";
import { saveUserProfile } from "@/lib/firebase/firestore-users";
import { getServiceMode } from "@/lib/services/service-mode";

export type AuthSession = {
  isSignedIn: boolean;
  provider: Provider;
  userId?: string;
};

export interface AuthService {
  signIn(provider: Exclude<Provider, null>): Promise<AuthSession>;
  ensureSession(): Promise<AuthSession>;
  signOut(): Promise<AuthSession>;
}

const DEVICE_ID_KEY = "cartalk.device-id";

async function getOrCreateDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const deviceId = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export const mockAuthService: AuthService = {
  async signIn(provider) {
    return {
      isSignedIn: true,
      provider,
      userId: await getOrCreateDeviceId()
    };
  },
  async ensureSession() {
    return {
      isSignedIn: true,
      provider: "anonymous",
      userId: await getOrCreateDeviceId()
    };
  },
  async signOut() {
    return {
      isSignedIn: false,
      provider: null
    };
  }
};

export const firebaseAuthService: AuthService = {
  async signIn(provider) {
    const auth = getFirebaseAuth();

    if (!auth) {
      throw new Error("Firebase auth is not configured");
    }

    let userId: string;
    let resolvedProvider: Exclude<Provider, null> = provider;

    if (provider === "google" && typeof window !== "undefined") {
      const googleProvider = new GoogleAuthProvider();
      googleProvider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, googleProvider);
      userId = result.user.uid;
    } else {
      // Native demo mode uses anonymous auth so standalone devices can work
      // without completing a separate sign-in flow.
      const credential = await signInAnonymously(auth);
      userId = credential.user.uid;
      resolvedProvider = "anonymous";
    }

    await saveUserProfile({
      id: userId,
      provider: resolvedProvider,
      country: "NL",
      language: "Dutch"
    });

    return {
      isSignedIn: true,
      provider: resolvedProvider,
      userId
    };
  },
  async ensureSession() {
    const auth = getFirebaseAuth();

    if (!auth) {
      throw new Error("Firebase auth is not configured");
    }

    const existingUser = auth.currentUser;
    const user = existingUser ?? (await signInAnonymously(auth)).user;

    await saveUserProfile({
      id: user.uid,
      provider: "anonymous",
      country: "NL",
      language: "Dutch"
    });

    return {
      isSignedIn: true,
      provider: "anonymous",
      userId: user.uid
    };
  },
  async signOut() {
    const auth = getFirebaseAuth();

    if (!auth) {
      throw new Error("Firebase auth is not configured");
    }

    await firebaseSignOut(auth);

    return {
      isSignedIn: false,
      provider: null
    };
  }
};

export function getAuthService(): AuthService {
  return getServiceMode() === "firebase" ? firebaseAuthService : mockAuthService;
}
