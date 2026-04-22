import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

interface PackageManifest {
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
}

const execFile = promisify(execFileCallback);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packMetadataPath = join(rootDir, ".exvex-pack.txt");
const distEntryPath = join(rootDir, "dist/index.js");
let tarballPath: string | undefined;
let extractedDir: string | undefined;

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
  const tarballName = packMetadata.match(/^exvex-.*\.tgz$/m)?.[0];
  assert.ok(tarballName, "Unable to determine packed tarball filename.");
  tarballPath = join(rootDir, tarballName);

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

  extractedDir = await mkdtemp(join(tmpdir(), "exvex-pack-check-"));
  await execFile("tar", ["-xzf", tarballPath, "-C", extractedDir]);

  const packagedRootDir = join(extractedDir, "package");
  const packageJson = JSON.parse(
    await readFile(join(packagedRootDir, "package.json"), "utf8"),
  ) as PackageManifest;

  assert.deepEqual(
    packageJson.dependencies ?? {},
    {},
    "Published manifest should not declare runtime dependencies.",
  );

  assert.equal(
    packageJson.bin && typeof packageJson.bin !== "string"
      ? packageJson.bin.exvex
      : packageJson.bin,
    "dist/index.js",
    "Published manifest should expose the exvex bin at dist/index.js.",
  );

  const packagedDistEntryPath = join(packagedRootDir, "dist/index.js");
  const distEntry = await readFile(packagedDistEntryPath, "utf8");
  assert.doesNotMatch(
    distEntry,
    /from\s*["']@clack\/prompts["']|import\s*\(\s*["']@clack\/prompts["']\s*\)/,
    "Built CLI must not keep external @clack/prompts imports. Bundle would break after publish.",
  );

  const { stdout } = await execFile(
    process.execPath,
    [packagedDistEntryPath, "--help"],
    { cwd: packagedRootDir },
  );
  assert.match(stdout, /Usage:/, "Packed CLI help output is missing Usage.");

  process.stdout.write("Packed tarball checks passed.\n");
} finally {
  if (extractedDir) {
    await rm(extractedDir, { recursive: true, force: true });
  }
  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
  await rm(packMetadataPath, { force: true });
}
