import { Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

export default function InboxScreen() {
  const { state } = useAppState();

  return (
    <Screen
      title="Alert history"
      eyebrow="Inbox"
      subtitle="This is where the receiver experience will live once push delivery is connected."
    >
      <View style={{ gap: 12 }}>
        {state.mockAlerts.map((alert) => (
          <View
            key={alert.id}
            style={{
              borderRadius: 18,
              padding: 16,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              gap: 6
            }}
          >
            <Text style={typography.cardTitle}>{alert.title}</Text>
            <Text style={typography.body}>{alert.body}</Text>
            <Text style={typography.caption}>{alert.receivedAt}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

