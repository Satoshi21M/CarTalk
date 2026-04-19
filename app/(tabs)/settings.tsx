import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { SelectField } from "@/components/select-field";
import { useAppState } from "@/lib/state/app-state";
import { VoiceOutputStyle } from "@/types/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

const voiceOutputLabels: Record<VoiceOutputStyle, string> = {
  seductive: "Verleidelijk",
  reggae: "Relaxte reggae-host",
  showman: "Bombastische showman",
  schoolmaster: "Schoolmeester"
};

export default function SettingsScreen() {
  const router = useRouter();
  const { state, setDriveStartMode, setVoiceOutputStyle, setVoiceDeliveryConfirmationEnabled, signOut } = useAppState();
  const [voiceOutputExpanded, setVoiceOutputExpanded] = useState(false);

  return (
    <Screen
      title="Accountinstellingen"
      eyebrow="Account"
      subtitle="Beheer voertuigen, rijgedrag en je CarTalk-account."
      footer={
        <>
          <Button label="Terug naar CarTalk" onPress={() => router.replace("/(tabs)/home")} />
          <Button label="Wijzig hoofdvoertuig" onPress={() => router.push("/vehicle")} tone="secondary" />
          <Button label="Voeg tweede voertuig toe" onPress={() => router.push("/vehicle")} tone="secondary" />
          <Button
            label="Uitloggen"
            tone="ghost"
            onPress={async () => {
              await signOut();
              router.replace("/welcome");
            }}
          />
        </>
      }
    >
      <View style={{ gap: 14 }}>
        <Text style={typography.body}>Ingelogd: {state.isSignedIn ? "Ja" : "Nee"}</Text>
        <Text style={typography.body}>Provider: {state.provider || "Niet ingesteld"}</Text>
        <View style={{ gap: 10 }}>
          <Text style={typography.cardTitle}>CarTalk activatie</Text>
          <Pressable
            onPress={() => setDriveStartMode("ask")}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: state.driveStartMode === "ask" ? palette.signal : palette.border,
              backgroundColor: state.driveStartMode === "ask" ? "#FFF2E2" : palette.surface,
              padding: 14,
              gap: 4
            }}
          >
            <Text style={typography.cardTitle}>Vraag het eerst</Text>
            <Text style={typography.caption}>CarTalk vraagt om bevestiging wanneer rijden wordt gedetecteerd.</Text>
          </Pressable>
          <Pressable
            onPress={() => setDriveStartMode("auto")}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: state.driveStartMode === "auto" ? palette.signal : palette.border,
              backgroundColor: state.driveStartMode === "auto" ? "#FFF2E2" : palette.surface,
              padding: 14,
              gap: 4
            }}
          >
            <Text style={typography.cardTitle}>Automatisch activeren</Text>
            <Text style={typography.caption}>
              CarTalk start wanneer autorijden wordt gedetecteerd en stopt wanneer de rit eindigt.
            </Text>
          </Pressable>
          <Text style={typography.caption}>
            Treinvermijding moet later snelheid, routecontext en auto-Bluetooth combineren.
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={typography.cardTitle}>Voice output</Text>
          <SelectField
            label="Kies de stijl van CarTalk"
            value={voiceOutputLabels[state.voiceOutputStyle]}
            placeholder="Kies een stijl"
            options={Object.values(voiceOutputLabels)}
            expanded={voiceOutputExpanded}
            onToggle={() => setVoiceOutputExpanded((current) => !current)}
            onSelect={(label) => {
              const nextStyle =
                (Object.entries(voiceOutputLabels).find(([, value]) => value === label)?.[0] as VoiceOutputStyle | undefined) ||
                "schoolmaster";
              setVoiceOutputStyle(nextStyle);
              setVoiceOutputExpanded(false);
            }}
          />
          <Text style={typography.caption}>
            CarTalk laat Gemini de toon van gesproken reacties aanpassen: charmant, laid-back, bombastisch of neutraal
            professioneel.
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={typography.cardTitle}>Spraakbevestiging na aflevering</Text>
          <Pressable
            onPress={() => setVoiceDeliveryConfirmationEnabled(true)}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: state.voiceDeliveryConfirmationEnabled ? palette.signal : palette.border,
              backgroundColor: state.voiceDeliveryConfirmationEnabled ? "#FFF2E2" : palette.surface,
              padding: 14,
              gap: 4
            }}
          >
            <Text style={typography.cardTitle}>Aan</Text>
            <Text style={typography.caption}>
              CarTalk bevestigt gesproken of je bericht is aangekomen of dat er nog geen passende gebruiker is gevonden.
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setVoiceDeliveryConfirmationEnabled(false)}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: !state.voiceDeliveryConfirmationEnabled ? palette.signal : palette.border,
              backgroundColor: !state.voiceDeliveryConfirmationEnabled ? "#FFF2E2" : palette.surface,
              padding: 14,
              gap: 4
            }}
          >
            <Text style={typography.cardTitle}>Uit</Text>
            <Text style={typography.caption}>CarTalk spreekt alleen de ontvanger-uitvoer uit, zonder afleverbevestiging.</Text>
          </Pressable>
        </View>
        <Text style={typography.caption}>
          Blokkeren, melden en vertrouwensinstellingen worden hier later verder uitgebreid.
        </Text>
      </View>
    </Screen>
  );
}
