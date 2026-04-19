import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

type SelectFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  options: readonly string[];
  expanded: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
};

export function SelectField({
  label,
  value,
  placeholder,
  options,
  expanded,
  onToggle,
  onSelect
}: SelectFieldProps) {
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={typography.label}>{label}</Text>
        <Pressable
          onPress={onToggle}
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surface,
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <Text style={[typography.body, { color: value ? palette.ink : palette.mutedInk }]}>
            {value || placeholder}
          </Text>
          <Text style={[typography.caption, { color: palette.mutedInk }]}>Kies</Text>
        </Pressable>
      </View>

      <Modal animationType="slide" transparent visible={expanded} onRequestClose={onToggle}>
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(18, 14, 10, 0.28)"
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onToggle} />
          <View
            style={{
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: palette.surface,
              paddingTop: 12,
              paddingBottom: 24,
              maxHeight: "72%"
            }}
          >
            <View
              style={{
                alignSelf: "center",
                width: 42,
                height: 5,
                borderRadius: 999,
                backgroundColor: palette.border,
                marginBottom: 16
              }}
            />
            <View
              style={{
                paddingHorizontal: 20,
                paddingBottom: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <Text style={typography.cardTitle}>{label}</Text>
              <Pressable onPress={onToggle}>
                <Text style={[typography.body, { color: palette.mutedInk }]}>Klaar</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ paddingHorizontal: 12, gap: 8 }}>
                {options.map((option) => {
                  const selected = value === option;

                  return (
                    <Pressable
                      key={option}
                      onPress={() => onSelect(option)}
                      style={{
                        borderRadius: 18,
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        backgroundColor: selected ? "#FFF2E2" : palette.canvas,
                        borderWidth: 1,
                        borderColor: selected ? palette.signal : "transparent"
                      }}
                    >
                      <Text style={typography.body}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
