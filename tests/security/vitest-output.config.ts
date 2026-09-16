import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/output/*.output.ts"],
    // These two files are the only ones that inspect the real built artifact: a glob that
    // stops matching must fail the build step, not report success on nothing.
    passWithNoTests: false,
    restoreMocks: true,
  },
});
