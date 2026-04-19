import { getRelayDebugSummary, getRelayWsBaseUrl } from "@/lib/live/relay-host";

export function getLiveRelayUrl() {
  return `${getRelayWsBaseUrl()}/live`;
}

export function createLiveRelaySocket() {
  const url = getLiveRelayUrl();
  console.info("[CarTalk] Opening live relay socket", {
    url,
    relay: getRelayDebugSummary()
  });
  return new WebSocket(url);
}
