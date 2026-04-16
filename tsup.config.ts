import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["./src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
    bundle: true,
    splitting: false,
    sourcemap: false,
    target: "es2022",
    minify: "terser",
    ignoreWatch: ["tests/files/**"],
  },
]);
