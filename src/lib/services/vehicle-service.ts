import { normalizeDutchPlate } from "@/features/vehicles/normalize-dutch-plate";
import { findVehicleRecordByPlate, saveVehicleForUser } from "@/lib/firebase/firestore-vehicles";
import { getServiceMode } from "@/lib/services/service-mode";

export type RegisteredVehicle = {
  userId?: string;
  plateDisplay: string;
  plateNormalized: string;
  country: "NL";
  brand: string;
  vehicleType: string;
  color: string;
};

export type VehicleRegistrationInput = {
  plate: string;
  brand: string;
  vehicleType: string;
  color: string;
};

export interface VehicleService {
  registerVehicle(userId: string, input: VehicleRegistrationInput): Promise<RegisteredVehicle>;
  findVehicleByPlate(plate: string): Promise<RegisteredVehicle | null>;
}

export const mockVehicleService: VehicleService = {
  async registerVehicle(_userId, input) {
    const normalized = normalizeDutchPlate(input.plate);

    return {
      userId: _userId,
      plateDisplay: normalized,
      plateNormalized: normalized,
      country: "NL",
      brand: input.brand.trim(),
      vehicleType: input.vehicleType.trim(),
      color: input.color.trim()
    };
  },
  async findVehicleByPlate(plate) {
    const normalized = normalizeDutchPlate(plate);

    if (normalized.length < 6) {
      return null;
    }

    return {
      userId: "",
      plateDisplay: normalized,
      plateNormalized: normalized,
      country: "NL",
      brand: "",
      vehicleType: "",
      color: ""
    };
  }
};

export const firebaseVehicleService: VehicleService = {
  async registerVehicle(userId, input) {
    const normalized = normalizeDutchPlate(input.plate);
    const vehicle = {
      userId,
      plateDisplay: normalized,
      plateNormalized: normalized,
      country: "NL" as const,
      brand: input.brand.trim(),
      vehicleType: input.vehicleType.trim(),
      color: input.color.trim()
    };

    await saveVehicleForUser(userId, vehicle);

    return vehicle;
  },
  async findVehicleByPlate(plate) {
    const normalized = normalizeDutchPlate(plate);
    return findVehicleRecordByPlate(normalized);
  }
};

export function getVehicleService(): VehicleService {
  return getServiceMode() === "firebase" ? firebaseVehicleService : mockVehicleService;
}
