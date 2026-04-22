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
    banner: {
      js: "#!/usr/bin/env node",
    },
    target: "es2022",
    minify: "terser",
  },
]);
