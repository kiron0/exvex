import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "tests/cli.test.ts",
      "tests/lib.test.ts",
      "tests/split-command-portability.test.ts",
    ],
  },
});
