import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const scratchDir = await mkdtemp(join(tmpdir(), "exvex-fresh-install-"));
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";

try {
  for (const relativePath of [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "tsup.config.ts",
    "src",
  ]) {
    await cp(join(rootDir, relativePath), join(scratchDir, relativePath), {
      recursive: true,
    });
  }

  const packageJsonPath = join(scratchDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };

  if (packageJson.scripts) {
    delete packageJson.scripts["test:fresh-install"];
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  await execFile(bunCommand, ["install", "--frozen-lockfile"], {
    cwd: scratchDir,
  });
  await execFile(bunCommand, ["run", "build"], {
    cwd: scratchDir,
  });

  process.stdout.write("Fresh install checks passed.\n");
} catch (error) {
  assert.fail(
    error instanceof Error ? error.message : "Fresh install check failed.",
  );
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}
