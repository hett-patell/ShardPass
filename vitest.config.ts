import { defineConfig } from "vitest/config";

const workspaceTests = ["apps/**/test/**/*.test.{ts,tsx}", "packages/**/test/**/*.test.{ts,tsx}"];

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [...workspaceTests, "tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.dom.test.{ts,tsx}"],
          restoreMocks: true,
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: [
            "apps/**/test/**/*.dom.test.{ts,tsx}",
            "packages/**/test/**/*.dom.test.{ts,tsx}",
            "tests/**/*.dom.test.{ts,tsx}",
          ],
          restoreMocks: true,
        },
      },
    ],
  },
});
