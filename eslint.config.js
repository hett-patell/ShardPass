import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".test-dist/**",
      "assets/**",
      "dist/**",
      "icons/**",
      "node_modules/**",
      "playwright-report/**",
      "service-worker-loader.js",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["packages/importers/src/generated/**/*.ts"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-warning-comments": "off",
    },
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: ["packages/ui/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "browser", message: "Use a platform port instead of browser globals." },
        { name: "chrome", message: "Use a platform port instead of browser globals." },
        { name: "document", message: "Pure packages must not use DOM globals." },
        { name: "navigator", message: "Pure packages must not use browser globals." },
        { name: "window", message: "Pure packages must not use DOM globals." },
      ],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: [
      "**/*.config.js",
      "dependency-cruiser.config.cjs",
      "eslint.config.js",
      "prettier.config.js",
      "scripts/**/*.mjs",
      "scripts/**/*.d.mts",
    ],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
);
