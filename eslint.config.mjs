import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/**",
      "ios/**",
      "node_modules/**",
      "server/**"
    ]
  }
]);
