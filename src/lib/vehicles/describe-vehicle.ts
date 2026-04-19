import { VehicleProfile } from "@/types/app-state";

function toTitleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function describeVehicleProfile(profile: VehicleProfile) {
  const parts = [profile.color, profile.brand, profile.vehicleType]
    .map((part) => toTitleCase(part || ""))
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  if (profile.plate.trim()) {
    return `Voertuig ${profile.plate.trim()}`;
  }

  return "CarTalk bestuurder";
}
