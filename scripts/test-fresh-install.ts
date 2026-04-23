import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const scratchDir = await mkdtemp(join(rootDir, ".tmp-exvex-fresh-install-"));

function formatWindowsCmdArg(value: string) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function runBun(args: string[]) {
  if (process.platform === "win32") {
    const commandLine = ["bun", ...args].map(formatWindowsCmdArg).join(" ");
    return await execFile("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: scratchDir,
    });
  }

  return await execFile("bun", args, {
    cwd: scratchDir,
  });
}

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

  await runBun(["install", "--frozen-lockfile"]);
  await runBun(["run", "build"]);

  process.stdout.write("Fresh install checks passed.\n");
} catch (error) {
  assert.fail(
    error instanceof Error ? error.message : "Fresh install check failed.",
  );
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}
