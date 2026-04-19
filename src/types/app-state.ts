export type PermissionKey = "microphone" | "location" | "bluetooth";
export type Provider = "google" | "email" | "anonymous" | null;

export type MockAlert = {
  id: string;
  title: string;
  body: string;
  receivedAt: string;
};

export type InboundDelivery = {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  receiverOutput: string;
  senderVehicleLabel: string;
  createdAt: number;
};

export type VehicleProfile = {
  plate: string;
  brand: string;
  vehicleType: string;
  color: string;
};

export type DriveStartMode = "ask" | "auto";
export type VoiceOutputStyle = "seductive" | "reggae" | "showman" | "schoolmaster";

export type AppState = {
  isSignedIn: boolean;
  provider: Provider;
  userId: string;
  language: "Dutch";
  permissions: Record<PermissionKey, boolean>;
  vehiclePlate: string;
  vehicleProfile: VehicleProfile;
  driveStartMode: DriveStartMode;
  voiceOutputStyle: VoiceOutputStyle;
  voiceDeliveryConfirmationEnabled: boolean;
  setupComplete: boolean;
  showSetupReadyNotice: boolean;
  isDrivingModeActive: boolean;
  mockAlerts: MockAlert[];
};
