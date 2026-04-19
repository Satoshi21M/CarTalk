import process from "node:process";

export function getServerConfig() {
  return {
    port: Number(process.env.LIVE_RELAY_PORT || 8787),
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiLiveModel: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    geminiAnalysisModel:
      process.env.GEMINI_ANALYSIS_MODEL || process.env.GEMINI_ANALYZE_MODEL || "gemini-2.5-flash",
    geminiAnalysisFallbackModel:
      process.env.GEMINI_ANALYSIS_FALLBACK_MODEL ||
      process.env.GEMINI_ANALYZE_MODEL_FALLBACK ||
      "gemini-2.5-flash-lite"
  };
}

export function assertGeminiServerConfig() {
  const config = getServerConfig();

  if (!config.geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  return config;
}
