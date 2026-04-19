import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

import { NativeVoiceTest } from "./native-voice-test";

export function TalkSurface() {
  const router = useRouter();
  const { state, dismissSetupReadyNotice, setDrivingModeActive } = useAppState();

  useEffect(() => {
    if (!state.showSetupReadyNotice) {
      return;
    }

    const timeout = setTimeout(() => {
      dismissSetupReadyNotice();
    }, 2400);

    return () => clearTimeout(timeout);
  }, [dismissSetupReadyNotice, state.showSetupReadyNotice]);

  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <Pressable
          onPress={() => router.push("/(tabs)/settings")}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface,
            alignItems: "center",
            justifyContent: "center",
            gap: 3
          }}
        >
          <View style={{ width: 16, height: 2, borderRadius: 2, backgroundColor: palette.ink }} />
          <View style={{ width: 16, height: 2, borderRadius: 2, backgroundColor: palette.ink }} />
          <View style={{ width: 16, height: 2, borderRadius: 2, backgroundColor: palette.ink }} />
        </Pressable>

        <View style={{ gap: 4, flex: 1, minWidth: 0, alignItems: "center" }}>
          <Text style={typography.h1}>CarTalk</Text>
          <Text style={[typography.body, { textAlign: "center" }]}>Veilige reis</Text>
        </View>
        <View style={{ width: 42 }} />
      </View>

      {state.showSetupReadyNotice ? (
        <View style={{ paddingTop: 10, minHeight: 22 }}>
          <Text style={[typography.caption, { color: "#6B8E6F" }]}>
            Installatie voltooid. CarTalk is klaar voor gebruik.
          </Text>
        </View>
      ) : null}

      <View style={{ flex: 1, justifyContent: "center" }}>
        <NativeVoiceTest
          active={state.isDrivingModeActive}
          mode="main"
          onActivateDrivingMode={() => setDrivingModeActive(true)}
        />
      </View>
    </View>
  );
}
