import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packMetadataPath = join(rootDir, ".exvex-pack.json");

try {
  const packMetadata = JSON.parse(await readFile(packMetadataPath, "utf8"));

  assert.ok(Array.isArray(packMetadata), "npm pack --json output must be an array.");
  assert.equal(packMetadata.length, 1, "Expected exactly one package entry from npm pack.");

  const [packageEntry] = packMetadata;
  assert.match(
    packageEntry.filename ?? "",
    /^exvex-.*\.tgz$/,
    "npm pack did not produce the expected tarball filename.",
  );

  const publishedFiles = new Set(
    Array.isArray(packageEntry.files)
      ? packageEntry.files.map((file) => file.path)
      : [],
  );

  for (const requiredPath of ["dist/index.js", "README.md", "LICENSE", "package.json"]) {
    assert.ok(
      publishedFiles.has(requiredPath),
      `Published tarball is missing required file: ${requiredPath}`,
    );
  }

  const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  assert.equal(
    packageJson.bin?.exvex,
    "dist/index.js",
    "Published manifest should expose the exvex bin at dist/index.js.",
  );

  process.stdout.write("Packed tarball checks passed.\n");
} finally {
  await rm(packMetadataPath, { force: true });
}
