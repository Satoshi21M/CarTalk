import AsyncStorage from "@react-native-async-storage/async-storage";

const APP_STATE_KEY = "cartalk.app-state";

export async function loadPersistedState() {
  const raw = await AsyncStorage.getItem(APP_STATE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function savePersistedState(value: unknown) {
  await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(value));
}

