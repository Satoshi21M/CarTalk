import { NativeModules, Platform } from "react-native";

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (!url.protocol.startsWith("http")) {
      return null;
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getScriptHost() {
  const scriptURL = NativeModules?.SourceCode?.scriptURL as string | undefined;

  if (!scriptURL) {
    return null;
  }

  try {
    return new URL(scriptURL).hostname;
  } catch {
    return null;
  }
}

function uniqueHosts(hosts: string[]) {
  return Array.from(
    new Set(
      hosts
        .map((host) => host.trim())
        .filter(Boolean)
    )
  );
}

function isIpv4Host(host: string) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host.trim());
}

function getExplicitHosts() {
  return uniqueHosts(
    (process.env.EXPO_PUBLIC_RELAY_HOST || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
  );
}

function getExplicitBaseUrls() {
  return Array.from(
    new Set(
      (process.env.EXPO_PUBLIC_RELAY_BASE_URL || "")
        .split(",")
        .map((value) => normalizeBaseUrl(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function getPreferredIpv4Host(hosts: string[]) {
  return hosts.find(isIpv4Host) || null;
}

export function getRelayHosts() {
  const explicitBaseUrls = getExplicitBaseUrls();
  if (explicitBaseUrls.length > 0) {
    return explicitBaseUrls
      .map((baseUrl) => {
        try {
          return new URL(baseUrl).hostname;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }

  const explicitHosts = getExplicitHosts();
  const explicitIpv4Host = getPreferredIpv4Host(explicitHosts);

  if (Platform.OS === "ios" && explicitIpv4Host) {
    return [explicitIpv4Host];
  }

  if (explicitHosts.length > 0) {
    return explicitIpv4Host ? [explicitIpv4Host] : explicitHosts;
  }

  if (Platform.OS === "android") {
    return ["10.0.2.2"];
  }

  return uniqueHosts([getScriptHost() || "", "localhost"]);
}

export function getRelayHost() {
  return getRelayHosts()[0] || "localhost";
}

export function getRelayPort() {
  const explicitBaseUrl = getExplicitBaseUrls()[0];
  if (explicitBaseUrl) {
    try {
      const port = new URL(explicitBaseUrl).port;
      return port ? Number.parseInt(port, 10) : new URL(explicitBaseUrl).protocol === "https:" ? 443 : 80;
    } catch {
      return 8787;
    }
  }

  return 8787;
}

export function getRelayHttpBaseUrls() {
  const explicitBaseUrls = getExplicitBaseUrls();
  if (explicitBaseUrls.length > 0) {
    return explicitBaseUrls;
  }

  return getRelayHosts().map((host) => `http://${host}:${getRelayPort()}`);
}

export function getRelayWsBaseUrls() {
  const explicitBaseUrls = getExplicitBaseUrls();
  if (explicitBaseUrls.length > 0) {
    return explicitBaseUrls.map((baseUrl) => {
      const url = new URL(baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString().replace(/\/$/, "");
    });
  }

  return getRelayHosts().map((host) => `ws://${host}:${getRelayPort()}`);
}

export function getRelayHttpBaseUrl() {
  return getRelayHttpBaseUrls()[0];
}

export function getRelayWsBaseUrl() {
  return getRelayWsBaseUrls()[0];
}

export function getRelayDebugSummary() {
  return {
    platform: Platform.OS,
    scriptHost: getScriptHost(),
    explicitBaseUrls: getExplicitBaseUrls(),
    explicitHosts: getExplicitHosts(),
    activeHosts: getRelayHosts(),
    activeHttpBaseUrl: getRelayHttpBaseUrl(),
    activeWsBaseUrl: getRelayWsBaseUrl()
  };
}
