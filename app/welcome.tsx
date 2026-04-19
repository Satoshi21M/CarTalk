import { useRouter } from "expo-router";
import { View, Text } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { appCopy } from "@/content/copy";
import { useAppState } from "@/lib/state/app-state";
import { typography } from "@/theme/typography";

export default function WelcomeScreen() {
  const router = useRouter();
  const { state } = useAppState();

  return (
    <Screen
      title="CarTalk"
      eyebrow="Nederlandse MVP"
      subtitle="Handsfree veiligheidsmeldingen voor bestuurders, te beginnen in Nederland."
      footer={
        <>
          <Button
            label="Start installatie"
            onPress={() => router.push("/permissions")}
          />
          <Button
            label="Bekijk beginscherm"
            onPress={() => router.push("/(tabs)/home")}
            tone="ghost"
          />
        </>
      }
    >
      <View style={{ gap: 16 }}>
        {appCopy.valueProps.map((item) => (
          <View
            key={item.title}
            style={{
              borderRadius: 20,
              padding: 18,
              backgroundColor: "#F6E8D8",
              gap: 6
            }}
          >
            <Text style={typography.cardTitle}>{item.title}</Text>
            <Text style={typography.body}>{item.body}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
