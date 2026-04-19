import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

export default function DriveStartScreen() {
  const router = useRouter();
  const { setDriveStartMode, state } = useAppState();

  const handleContinue = async () => {
    router.push("/setup-test");
  };

  return (
    <Screen
      title="CarTalk activatie"
      eyebrow="Automatisering"
      subtitle="Kies hoe CarTalk zich moet gedragen zodra we autorijden detecteren."
      footer={<Button label="Verder naar stemtest" onPress={() => void handleContinue()} />}
    >
      <View style={{ gap: 14 }}>
        <Pressable
          onPress={() => setDriveStartMode("ask")}
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: state.driveStartMode === "ask" ? palette.signal : palette.border,
            backgroundColor: state.driveStartMode === "ask" ? "#FFF2E2" : palette.surface,
            padding: 16,
            gap: 6
          }}
        >
            <Text style={typography.cardTitle}>Vraag het eerst</Text>
            <Text style={typography.body}>
            CarTalk detecteert autorijden en vraagt of de spraakmodus geactiveerd moet worden.
            </Text>
          </Pressable>

        <Pressable
          onPress={() => setDriveStartMode("auto")}
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: state.driveStartMode === "auto" ? palette.signal : palette.border,
            backgroundColor: state.driveStartMode === "auto" ? "#FFF2E2" : palette.surface,
            padding: 16,
            gap: 6
          }}
        >
            <Text style={typography.cardTitle}>Automatisch activeren</Text>
            <Text style={typography.body}>
            CarTalk schakelt in zodra we autorijden detecteren en stopt wanneer de rit eindigt.
            </Text>
          </Pressable>

        <Text style={typography.caption}>
          Om treinen later te vermijden, moet de live detector beweging, snelheidsbereik en auto-Bluetooth combineren.
        </Text>
      </View>
    </Screen>
  );
}
