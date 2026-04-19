import { VehicleProfile } from "@/types/app-state";

export type PrototypeRecipient = {
  id: string;
  label: string;
  plate: string;
  brand: string;
  color: string;
  vehicleType: string;
};

const baseRecipients: PrototypeRecipient[] = [
  {
    id: "recipient-volvo",
    label: "zwarte Volvo SUV",
    plate: "KJ-482-T",
    brand: "Volvo",
    color: "Zwart",
    vehicleType: "SUV"
  },
  {
    id: "recipient-mercedes",
    label: "rode Mercedes Sedan",
    plate: "ABC-123",
    brand: "Mercedes-Benz",
    color: "Rood",
    vehicleType: "Sedan"
  },
  {
    id: "recipient-volkswagen",
    label: "witte Volkswagen Bestelwagen",
    plate: "V-83-KPX",
    brand: "Volkswagen",
    color: "Wit",
    vehicleType: "Bestelwagen"
  }
];

export function buildPrototypeRecipients(vehicleProfile: VehicleProfile): PrototypeRecipient[] {
  const recipients = [...baseRecipients];

  if (
    vehicleProfile.plate.trim() &&
    vehicleProfile.brand.trim() &&
    vehicleProfile.color.trim() &&
    vehicleProfile.vehicleType.trim()
  ) {
    recipients.push({
      id: "recipient-local-user",
      label: `${vehicleProfile.color} ${vehicleProfile.brand} ${vehicleProfile.vehicleType}`.trim(),
      plate: vehicleProfile.plate,
      brand: vehicleProfile.brand,
      color: vehicleProfile.color,
      vehicleType: vehicleProfile.vehicleType
    });
  }

  return recipients;
}
