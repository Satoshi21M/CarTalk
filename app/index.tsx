import { Redirect } from "expo-router";

import { Screen } from "@/components/screen";
import { useAppState } from "@/lib/state/app-state";

export default function Index() {
  const { state, isHydrated } = useAppState();

  if (!isHydrated) {
    return (
      <Screen title="CarTalk" scrollable={false}>
        <></>
      </Screen>
    );
  }

  return <Redirect href={state.setupComplete ? "/(tabs)/home" : "/welcome"} />;
}
