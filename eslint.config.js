// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    files: ["home-monitor/**/*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly" },
    },
  },
  {
    ignores: ["dist/*"],
  }
]);
