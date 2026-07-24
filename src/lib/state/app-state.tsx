import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AppState as NativeAppState } from "react-native";

import {
  acknowledgeLiveDelivery,
  clearUserPresence,
  setUserPresence,
  subscribeToLiveDeliveries
} from "@/lib/firebase/realtime-db";
import {
  acknowledgeHostedDelivery,
  clearHostedPresence,
  pollHostedDeliveries,
  setHostedPresence
} from "@/lib/live/hosted-network";
import { getAuthService } from "@/lib/services/auth-service";
import { getServiceMode } from "@/lib/services/service-mode";
import { getVehicleService, VehicleRegistrationInput } from "@/lib/services/vehicle-service";
import { loadPersistedState, savePersistedState } from "@/lib/storage/storage";
import {
  AppState,
  DriveStartMode,
  InboundDelivery,
  PermissionKey,
  Provider,
  VehicleProfile,
  VoiceOutputStyle
} from "@/types/app-state";
import { describeVehicleProfile } from "@/lib/vehicles/describe-vehicle";

type AppContextValue = {
  state: AppState;
  isHydrated: boolean;
  pendingInboundDeliveries: InboundDelivery[];
  signIn: (provider: Exclude<Provider, null>) => Promise<void>;
  signOut: () => Promise<void>;
  togglePermission: (permission: PermissionKey) => void;
  setPermission: (permission: PermissionKey, enabled: boolean) => void;
  registerVehicle: (input: VehicleRegistrationInput) => Promise<void>;
  setDriveStartMode: (mode: DriveStartMode) => void;
  setVoiceOutputStyle: (style: VoiceOutputStyle) => void;
  setVoiceDeliveryConfirmationEnabled: (enabled: boolean) => void;
  completeSetup: () => void;
  dismissSetupReadyNotice: () => void;
  setDrivingModeActive: (active: boolean) => void;
  acknowledgeInboundDelivery: (deliveryId: string) => Promise<void>;
  addInboxAlert: (title: string, body: string, receivedAt?: string) => void;
};

const emptyVehicleProfile: VehicleProfile = {
  plate: "",
  brand: "",
  vehicleType: "",
  color: ""
};

const initialState: AppState = {
  isSignedIn: false,
  provider: null,
  userId: "",
  language: "Dutch",
  permissions: {
    microphone: false,
    location: false,
    bluetooth: false
  },
  vehiclePlate: "",
  vehicleProfile: emptyVehicleProfile,
  driveStartMode: "ask",
  voiceOutputStyle: "schoolmaster",
  voiceDeliveryConfirmationEnabled: true,
  setupComplete: false,
  showSetupReadyNotice: false,
  isDrivingModeActive: false,
  mockAlerts: [
    {
      id: "1",
      title: "Veiligheidsmelding",
      body: "Uw rechter achterlicht lijkt kapot.",
      receivedAt: "Today, 08:42"
    },
    {
      id: "2",
      title: "Veiligheidsmelding",
      body: "Uw achterklep lijkt nog open te staan.",
      receivedAt: "Yesterday, 18:10"
    }
  ]
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingInboundDeliveries, setPendingInboundDeliveries] = useState<InboundDelivery[]>([]);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      const persisted = await loadPersistedState();

      if (mounted && persisted) {
        setState((current) => ({
          ...current,
          ...persisted,
          vehicleProfile: {
            ...emptyVehicleProfile,
            ...persisted.vehicleProfile,
            vehicleType:
              persisted.vehicleProfile?.vehicleType || persisted.vehicleProfile?.model || emptyVehicleProfile.vehicleType
          }
        }));
      }

      if (mounted) {
        setIsHydrated(true);
      }
    }

    void hydrate();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void savePersistedState(state);
  }, [isHydrated, state]);

  useEffect(() => {
    const hasValidDeviceIdentity =
      state.isSignedIn &&
      Boolean(state.userId) &&
      !state.userId.startsWith("mock-") &&
      state.userId !== "local-user";

    if (!isHydrated || hasValidDeviceIdentity) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const session = await getAuthService().ensureSession();
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          isSignedIn: session.isSignedIn,
          provider: session.provider,
          userId: session.userId ?? current.userId
        }));
      } catch {
        // Keep the app usable in fallback/mock mode even if silent auth fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, state.isSignedIn, state.userId]);

  useEffect(() => {
    if (!isHydrated || !state.isSignedIn || !state.userId || !state.setupComplete) {
      return;
    }

    const vehicleLabel = describeVehicleProfile(state.vehicleProfile);
    const serviceMode = getServiceMode();
    let active = true;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const syncPresence = async (nextStatus: string) => {
      if (!active) {
        return;
      }

      try {
        if (nextStatus === "active") {
          if (serviceMode === "firebase") {
            await setUserPresence(state.userId, vehicleLabel);
          } else {
            await setHostedPresence(state.userId, state.vehicleProfile, vehicleLabel);
          }
        } else if (serviceMode === "firebase") {
          await clearUserPresence(state.userId);
        } else {
          await clearHostedPresence(state.userId);
        }
      } catch {
        // Presence retries on the next heartbeat; voice use remains available.
      }
    };

    void syncPresence(NativeAppState.currentState);
    if (NativeAppState.currentState === "active") {
      heartbeat = setInterval(() => {
        void syncPresence("active");
      }, 20_000);
    }
    const subscription = NativeAppState.addEventListener("change", (nextStatus) => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (nextStatus === "active") {
        heartbeat = setInterval(() => {
          void syncPresence("active");
        }, 20_000);
      }
      void syncPresence(nextStatus);
    });

    return () => {
      active = false;
      subscription.remove();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (serviceMode === "firebase") {
        void clearUserPresence(state.userId);
      } else {
        void clearHostedPresence(state.userId).catch(() => {});
      }
    };
  }, [isHydrated, state.isSignedIn, state.setupComplete, state.userId, state.vehicleProfile]);

  useEffect(() => {
    if (!isHydrated || !state.isSignedIn || !state.userId || !state.setupComplete) {
      return;
    }

    const receiveDelivery = (delivery: InboundDelivery) => {
      setPendingInboundDeliveries((current) => {
        if (current.some((item) => item.id === delivery.id)) {
          return current;
        }
        return [...current, delivery];
      });

      setState((current) => ({
        ...current,
        mockAlerts: [
          {
            id: delivery.id,
            title: "Veiligheidsmelding ontvangen",
            body: delivery.receiverOutput,
            receivedAt: "Zojuist"
          },
          ...current.mockAlerts.filter((alert) => alert.id !== delivery.id)
        ].slice(0, 20)
      }));
    };

    if (getServiceMode() === "firebase") {
      return subscribeToLiveDeliveries(state.userId, receiveDelivery);
    }

    let active = true;
    let polling = false;
    const poll = async () => {
      if (!active || polling || NativeAppState.currentState !== "active") {
        return;
      }
      polling = true;
      try {
        const deliveries = await pollHostedDeliveries(state.userId);
        if (active) {
          deliveries.forEach(receiveDelivery);
        }
      } catch {
        // Polling automatically retries; a temporary network failure is not fatal.
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 2_500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isHydrated, state.isSignedIn, state.setupComplete, state.userId]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      isHydrated,
      pendingInboundDeliveries,
      async signIn(provider) {
        const session = await getAuthService().signIn(provider);

        setState((current) => ({
          ...current,
          isSignedIn: session.isSignedIn,
          provider: session.provider,
          userId: session.userId ?? current.userId
        }));
      },
      async signOut() {
        const session = await getAuthService().signOut();

        setState(initialState);
        setState((current) => ({
          ...current,
          isSignedIn: session.isSignedIn,
          provider: session.provider
        }));
      },
      togglePermission(permission) {
        setState((current) => ({
          ...current,
          permissions: {
            ...current.permissions,
            [permission]: !current.permissions[permission]
          }
        }));
      },
      setPermission(permission, enabled) {
        setState((current) => ({
          ...current,
          permissions: {
            ...current.permissions,
            [permission]: enabled
          }
        }));
      },
      setDriveStartMode(mode) {
        setState((current) => ({
          ...current,
          driveStartMode: mode
        }));
      },
      setVoiceOutputStyle(style) {
        setState((current) => ({
          ...current,
          voiceOutputStyle: style
        }));
      },
      setVoiceDeliveryConfirmationEnabled(enabled) {
        setState((current) => ({
          ...current,
          voiceDeliveryConfirmationEnabled: enabled
        }));
      },
      completeSetup() {
        setState((current) => ({
          ...current,
          setupComplete: true,
          showSetupReadyNotice: true,
          isDrivingModeActive: current.driveStartMode === "auto"
        }));
      },
      dismissSetupReadyNotice() {
        setState((current) => ({
          ...current,
          showSetupReadyNotice: false
        }));
      },
      setDrivingModeActive(active) {
        setState((current) => ({
          ...current,
          isDrivingModeActive: active
        }));
      },
      async acknowledgeInboundDelivery(deliveryId) {
        setPendingInboundDeliveries((current) => current.filter((item) => item.id !== deliveryId));
        if (state.userId) {
          if (getServiceMode() === "firebase") {
            await acknowledgeLiveDelivery(state.userId, deliveryId);
          } else {
            await acknowledgeHostedDelivery(state.userId, deliveryId);
          }
        }
      },
      addInboxAlert(title, body, receivedAt = "Zojuist") {
        setState((current) => ({
          ...current,
          mockAlerts: [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title,
              body,
              receivedAt
            },
            ...current.mockAlerts
          ].slice(0, 20)
        }));
      },
      async registerVehicle(input) {
        const userId = state.userId || "local-user";
        const vehicle = await getVehicleService().registerVehicle(userId, input);

        setState((current) => ({
          ...current,
          vehiclePlate: vehicle.plateDisplay,
          vehicleProfile: {
            plate: vehicle.plateDisplay,
            brand: vehicle.brand,
            vehicleType: vehicle.vehicleType,
            color: vehicle.color
          }
        }));
      }
    }),
    [isHydrated, pendingInboundDeliveries, state]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppState must be used inside AppProvider");
  }

  return context;
}
