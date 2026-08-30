// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Plain-Node build scripts, not app code: they run under `node`, not Metro,
    // so Node's globals are legitimately in scope. Without this `npx eslint .`
    // reports `'Buffer' is not defined` in build-icons.mjs — `expo lint` misses
    // it only because it does not reach outside the app source. Declaring the
    // globals for this one directory keeps no-undef enforced everywhere else,
    // which is the opposite of switching the rule off.
    files: ["scripts/**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    // DESIGN.md: components read colour and font-family values from src/theme, never
    // write them as literals. Scoped to component code only, so src/theme/** (where the
    // tokens legitimately live) is untouched, and test files are excluded since they
    // correctly pin literal values to assert against.
    //
    // src/screens/** is listed alongside src/app/** and src/components/**: screens render
    // UI just as directly as components do, and src/app/** itself now holds nothing but
    // thin route re-exports (see src/app/index.tsx) — without this, moving a screen out of
    // the swept routes directory would silently drop it out of this rule's coverage too.
    files: [
      "src/app/**/*.ts",
      "src/app/**/*.tsx",
      "src/components/**/*.ts",
      "src/components/**/*.tsx",
      "src/screens/**/*.ts",
      "src/screens/**/*.tsx",
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
