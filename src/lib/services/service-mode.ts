import { hasFirebaseConfig } from "@/lib/firebase/config";

export function getServiceMode() {
  return hasFirebaseConfig() ? "firebase" : "mock";
}
