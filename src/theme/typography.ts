import { TextStyle } from "react-native";

import { palette } from "@/theme/palette";

export const typography: Record<string, TextStyle> = {
  eyebrow: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: palette.mutedInk,
    fontWeight: "700"
  },
  h1: {
    fontSize: 34,
    lineHeight: 40,
    color: palette.ink,
    fontWeight: "700"
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: palette.ink
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedInk
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: palette.ink,
    fontWeight: "700"
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedInk,
    fontWeight: "600"
  },
  button: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700"
  }
};

