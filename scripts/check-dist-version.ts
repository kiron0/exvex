import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  version: string;
}

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const distEntryPath = join(rootDir, "dist/index.js");
const packageJsonPath = join(rootDir, "package.json");

const packageJson = JSON.parse(
  await readFile(packageJsonPath, "utf8"),
) as PackageManifest;

assert.match(
  packageJson.version,
  /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
  "package.json version must be a valid semver-like version.",
);

const distEntry = await readFile(distEntryPath, "utf8");
const distVersion = distEntry.match(
  /\b[A-Za-z_$][\w$]*="(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)";import\{/,
)?.[1];

assert.equal(
  distVersion,
  packageJson.version,
  `Built CLI version mismatch: dist reports ${distVersion}, package.json is ${packageJson.version}. Run \`bun run build\` before publishing.`,
);

process.stdout.write(`Dist version matches package.json: ${distVersion}\n`);
