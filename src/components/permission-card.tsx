import { Pressable, Text, View } from "react-native";

import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

type PermissionCardProps = {
  title: string;
  body: string;
  enabled: boolean;
  onPress: () => void;
};

export function PermissionCard({ title, body, enabled, onPress }: PermissionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: enabled ? "#6B8E6F" : palette.border,
        backgroundColor: enabled ? "#E7F2EA" : palette.surface,
        gap: 6
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={typography.cardTitle}>{title}</Text>
        <Text style={typography.label}>{enabled ? "Ingeschakeld" : "Tik om in te schakelen"}</Text>
      </View>
      <Text style={typography.body}>{body}</Text>
    </Pressable>
  );
}
