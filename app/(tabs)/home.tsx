import { SafeAreaView } from "react-native-safe-area-context";

import { TalkSurface } from "@/features/talk/talk-surface";
import { palette } from "@/theme/palette";

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <TalkSurface />
    </SafeAreaView>
  );
}
