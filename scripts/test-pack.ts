import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackFileEntry {
  path?: string;
}

interface PackEntry {
  filename?: string;
  files?: PackFileEntry[];
}

interface PackageManifest {
  bin?: string | Record<string, string>;
}

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packMetadataPath = join(rootDir, ".exvex-pack.json");
const npmCacheDir = join(rootDir, ".npm-cache");
const distEntryPath = join(rootDir, "dist/index.js");

try {
  await assert.doesNotReject(
    access(distEntryPath),
    "Built artifact missing at dist/index.js. Run `npm run build` first.",
  );

  const packMetadata = JSON.parse(
    await readFile(packMetadataPath, "utf8"),
  ) as unknown;

  assert.ok(
    Array.isArray(packMetadata),
    "npm pack --json output must be an array.",
  );
  assert.equal(
    packMetadata.length,
    1,
    "Expected exactly one package entry from npm pack.",
  );

  const [packageEntry] = packMetadata as PackEntry[];
  assert.match(
    packageEntry.filename ?? "",
    /^exvex-.*\.tgz$/,
    "npm pack did not produce the expected tarball filename.",
  );

  const publishedFiles = new Set(
    Array.isArray(packageEntry.files)
      ? packageEntry.files.flatMap((file) =>
          typeof file.path === "string" ? [file.path] : [],
        )
      : [],
  );

  for (const requiredPath of [
    "dist/index.js",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    assert.ok(
      publishedFiles.has(requiredPath),
      `Published tarball is missing required file: ${requiredPath}`,
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
  await rm(npmCacheDir, { recursive: true, force: true });
}
