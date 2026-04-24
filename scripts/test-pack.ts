import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

interface PackageManifest {
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  version?: string;
}

const execFile = promisify(execFileCallback);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packMetadataPath = join(rootDir, ".exvex-pack.txt");
const distEntryPath = join(rootDir, "dist/index.js");
let tarballPath: string | undefined;
let installDir: string | undefined;

function getNpmCliPath() {
  const npmCliPath = process.env.npm_execpath;

  assert.ok(
    npmCliPath,
    "npm_execpath is required to run package-manager checks.",
  );

  return npmCliPath;
}

async function runNpm(args: string[], cwd: string) {
  return await execFile(process.execPath, [getNpmCliPath(), ...args], { cwd });
}

async function installTarball(tarballPath: string, cwd: string) {
  return await runNpm(["install", "--no-save", tarballPath], cwd);
}

try {
  try {
    await access(distEntryPath);
  } catch {
    await runNpm(["run", "build"], rootDir);
  }

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

  installDir = await mkdtemp(join(rootDir, ".tmp-exvex-pack-check-"));
  await writeFile(
    join(installDir, "package.json"),
    '{\n  "name": "exvex-pack-check",\n  "private": true\n}\n',
    "utf8",
  );
  await installTarball(tarballPath, installDir);

  const packagedRootDir = join(installDir, "node_modules", "exvex");
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

  const { stdout: versionStdout } = await execFile(
    process.execPath,
    [packagedDistEntryPath, "--version"],
    { cwd: packagedRootDir },
  );
  assert.equal(
    versionStdout.trim(),
    packageJson.version,
    "Packed CLI version must match the published manifest version.",
  );

  process.stdout.write("Packed tarball checks passed.\n");
} finally {
  if (installDir) {
    await rm(installDir, { recursive: true, force: true });
  }
  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
  await rm(packMetadataPath, { force: true });
}
