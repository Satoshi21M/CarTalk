import { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

type ScreenProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
};

export function Screen({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  scrollable = true
}: ScreenProps) {
  const { isHydrated } = useAppState();

  if (!isHydrated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Text style={typography.body}>CarTalk wordt geladen...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const content = (
    <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, gap: 24 }}>
      <View style={{ gap: 8 }}>
        {eyebrow ? <Text style={typography.eyebrow}>{eyebrow}</Text> : null}
        <Text style={typography.h1}>{title}</Text>
        {subtitle ? <Text style={typography.body}>{subtitle}</Text> : null}
      </View>

      <View style={scrollable ? undefined : { flex: 1 }}>{children}</View>

      {footer ? <View style={{ gap: 12 }}>{footer}</View> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
