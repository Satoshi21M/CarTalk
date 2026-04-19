import * as Location from "expo-location";

import { removeUserLocation, writeUserLocation } from "@/lib/firebase/realtime-db";

export type LocationUpdate = {
  lat: number;
  lng: number;
  accuracy: number | null;
};

/**
 * Tracks the user's location while driving and writes it to the GeoFire
 * index in Firebase Realtime Database.
 *
 * Lifecycle:
 *   - Call `start()` when the user activates driving mode.
 *   - Call `stop()` when they leave driving mode or sign out.
 *     This deletes the location entry so other users can no longer find them.
 */
export class DrivingLocationService {
  private subscription: Location.LocationSubscription | null = null;

  async start(userId: string, onUpdate?: (loc: LocationUpdate) => void): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return false;

    this.subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000, // at most every 15s
        distanceInterval: 50  // or every 50 m
      },
      async (loc) => {
        const { latitude, longitude, accuracy } = loc.coords;
        await writeUserLocation(userId, latitude, longitude);
        onUpdate?.({ lat: latitude, lng: longitude, accuracy });
      }
    );

    return true;
  }

  async stop(userId: string): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    await removeUserLocation(userId);
  }
}
