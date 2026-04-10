import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  bin?: string | Record<string, string>;
}

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packMetadataPath = join(rootDir, ".exvex-pack.txt");
const distEntryPath = join(rootDir, "dist/index.js");

try {
  await assert.doesNotReject(
    access(distEntryPath),
    "Built artifact missing at dist/index.js. Run `bun run build` first.",
  );

  const packMetadata = await readFile(packMetadataPath, "utf8");

  assert.match(
    packMetadata,
    /^exvex-.*\.tgz$/m,
    "bun pm pack did not report the expected tarball filename.",
  );

  for (const requiredPath of [
    "dist/index.js",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    assert.match(
      packMetadata,
      new RegExp(`packed\\s+.+\\s+${requiredPath.replace(/\./g, "\\.")}`),
      `Packed tarball listing is missing required file: ${requiredPath}`,
    );
  }

  const packageJson = JSON.parse(
    await readFile(join(rootDir, "package.json"), "utf8"),
  ) as PackageManifest;
  assert.equal(
    packageJson.bin && typeof packageJson.bin !== "string"
      ? packageJson.bin.exvex
      : packageJson.bin,
    "dist/index.js",
    "Published manifest should expose the exvex bin at dist/index.js.",
  );

  process.stdout.write("Packed tarball checks passed.\n");
} finally {
  await rm(packMetadataPath, { force: true });
}
