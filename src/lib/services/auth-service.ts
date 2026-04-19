import { Provider } from "@/types/app-state";
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

export const mockAuthService: AuthService = {
  async signIn(provider) {
    return {
      isSignedIn: true,
      provider,
      userId: `mock-${provider}-user`
    };
  },
  async ensureSession() {
    return {
      isSignedIn: true,
      provider: "anonymous",
      userId: "mock-anonymous-user"
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
