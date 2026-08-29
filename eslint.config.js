// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // DESIGN.md: components read colour and font-family values from src/theme, never
    // write them as literals. Scoped to component code only, so src/theme/** (where the
    // tokens legitimately live) is untouched, and test files are excluded since they
    // correctly pin literal values to assert against.
    files: [
      "src/app/**/*.ts",
      "src/app/**/*.tsx",
      "src/components/**/*.ts",
      "src/components/**/*.tsx",
    ],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]", message: "Colour literals belong in src/theme/tokens.js." },
        { selector: "Property[key.name='fontFamily'] > Literal", message: "Font families come from tokens via src/theme/fonts.ts." },
      ],
    },
  },
]);
