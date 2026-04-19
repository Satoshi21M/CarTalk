import { Pressable, Text } from "react-native";

import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "ghost";
};

export function Button({ label, onPress, disabled = false, tone = "primary" }: ButtonProps) {
  const backgroundColor =
    tone === "primary" ? palette.signal : tone === "secondary" ? palette.surface : "transparent";
  const borderColor = tone === "ghost" ? palette.border : backgroundColor;
  const textColor = tone === "primary" ? "#1E1A17" : palette.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 18,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        opacity: disabled ? 0.45 : 1,
        alignItems: "center"
      }}
    >
      <Text style={[typography.button, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

