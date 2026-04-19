import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { NativeVoiceTest } from "@/features/talk/native-voice-test";
import { useAppState } from "@/lib/state/app-state";
import { typography } from "@/theme/typography";

export default function SetupTestScreen() {
  const router = useRouter();
  const { completeSetup, setDrivingModeActive } = useAppState();

  const handleContinue = () => {
    completeSetup();
    router.replace("/(tabs)/home");
  };

  return (
    <Screen
      title="Optionele stemtest"
      eyebrow="Test"
      subtitle="Probeer CarTalk meteen even uit. Spreek informeel in en luister hoe de ontvanger een nette veiligheidsmelding hoort."
      footer={
        <View style={{ gap: 10 }}>
          <Button label="Open CarTalk" onPress={handleContinue} />
          <Button label="Sla test over" tone="secondary" onPress={handleContinue} />
        </View>
      }
    >
      <View style={{ gap: 18 }}>
        <Text style={typography.caption}>
          Zeg bijvoorbeeld: "Yo man, je lichten zijn uit, zet ze even aan."
        </Text>

        <NativeVoiceTest
          active={false}
          mode="setup"
          onActivateDrivingMode={() => setDrivingModeActive(true)}
        />
      </View>
    </Screen>
  );
}
