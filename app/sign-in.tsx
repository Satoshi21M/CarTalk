import { useRouter } from "expo-router";
import { View, Text } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { useAppState } from "@/lib/state/app-state";
import { getServiceMode } from "@/lib/services/service-mode";
import { typography } from "@/theme/typography";

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAppState();
  const serviceMode = getServiceMode();

  const handleSignIn = async (provider: "google" | "email") => {
    await signIn(provider);
    router.push("/permissions" as never);
  };

  return (
    <Screen
      title="Maak je CarTalk-account"
      eyebrow="Account"
      subtitle="CarTalk maakt voor deze demo automatisch een veilige account aan, zodat je direct kunt koppelen, verzenden en ontvangen."
      footer={
        <>
          <Button label="Doorgaan" onPress={() => void handleSignIn("email")} />
          <Button label="Verder zonder keuze" onPress={() => void handleSignIn("google")} tone="secondary" />
        </>
      }
    >
      <View style={{ gap: 14 }}>
        <Text style={typography.body}>
          CarTalk is ontworpen om simpel te zijn: je toestel krijgt automatisch een demo-account en daarna doe je alles met je stem.
        </Text>
        <Text style={typography.body}>
          Je kunt later altijd overstappen naar een uitgebreidere accountflow. Voor nu houden we de demo frictieloos.
        </Text>
        {serviceMode === "mock" ? (
          <Text style={typography.caption}>
            Prototypemodus: inloggen is nu nog gesimuleerd terwijl we de live backend afronden.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
