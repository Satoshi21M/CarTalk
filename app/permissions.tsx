import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Text, View } from "react-native";
import { requestRecordingPermissionsAsync } from "expo-audio";
import {
  ExpoSpeechRecognitionModule
} from "expo-speech-recognition";

import { Button } from "@/components/button";
import { PermissionCard } from "@/components/permission-card";
import { Screen } from "@/components/screen";
import { useAppState } from "@/lib/state/app-state";
import { typography } from "@/theme/typography";

export default function PermissionsScreen() {
  const router = useRouter();
  const { state, setPermission, togglePermission } = useAppState();

  const requestVoiceAccess = async () => {
    try {
      const [speechPermission, recordingPermission] = await Promise.all([
        ExpoSpeechRecognitionModule.requestPermissionsAsync(),
        requestRecordingPermissionsAsync()
      ]);
      setPermission("microphone", Boolean(speechPermission.granted && recordingPermission.granted));
    } catch {
      setPermission("microphone", false);
    }
  };

  const requestLocationAccess = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      setPermission("location", permission.status === "granted");
    } catch {
      setPermission("location", false);
    }
  };

  return (
    <Screen
      title="Sta stem en locatie toe"
      eyebrow="Installatie"
      subtitle="Stem en locatie zijn vereist om CarTalk handsfree te laten werken. CarTalk bewaart geen spraakberichten of live locaties nadat ze zijn gebruikt."
      footer={
        <Button
          label="Ga verder naar voertuig"
          onPress={() => router.push("/vehicle")}
          disabled={!state.permissions.microphone || !state.permissions.location}
        />
      }
    >
      <View style={{ gap: 12 }}>
        <PermissionCard
          title="Stem"
          body="Vereist om Hey CarTalk te herkennen en handsfree veiligheidsmeldingen op te nemen."
          enabled={state.permissions.microphone}
          onPress={() => void requestVoiceAccess()}
        />
        <PermissionCard
          title="Locatie"
          body="Vereist om bestuurders in de buurt te vinden. Je live locatie wordt alleen tijdens gebruik ingezet en niet blijvend bewaard."
          enabled={state.permissions.location}
          onPress={() => void requestLocationAccess()}
        />
        <PermissionCard
          title="Bluetooth-audio"
          body="Helpt om audio via de auto af te spelen als toestel en voertuig dat ondersteunen."
          enabled={state.permissions.bluetooth}
          onPress={() => togglePermission("bluetooth")}
        />
        <Text style={typography.caption}>
          Zonder stem- en locatietoegang werkt CarTalk niet. Bluetooth blijft optioneel en best effort.
        </Text>
      </View>
    </Screen>
  );
}
