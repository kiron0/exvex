import { execFile as execFileCallback } from "child_process";
import { readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packOutputPath = join(rootDir, ".exvex-pack-test.txt");
const distEntryPath = join(rootDir, "dist", "index.js");
const bunDescribe = (await canRunBun()) ? describe : describe.skip;

let packOutput = "";
let packageVersion = "";

async function canRunBun() {
  try {
    await execFile(bunCommand, ["--version"], {
      cwd: rootDir,
    });
    return true;
  } catch {
    return false;
  }
}

bunDescribe("packed tarball", () => {
  beforeAll(async () => {
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    ) as {
      version?: string;
    };

    packageVersion = packageJson.version ?? "";
    await execFile(bunCommand, ["run", "build"], {
      cwd: rootDir,
    });

    const { stdout } = await execFile(bunCommand, ["pm", "pack", "--dry-run"], {
      cwd: rootDir,
    });

    packOutput = stdout;
    await writeFile(packOutputPath, stdout);
  }, 240000);

  afterAll(async () => {
    await rm(packOutputPath, { force: true });
  });

  it("includes the expected published files in bun pm pack output", () => {
    expect(packOutput).toContain(`exvex-${packageVersion}.tgz`);
    expect(packOutput).toContain("packed");
    expect(packOutput).toContain("package.json");
    expect(packOutput).toContain("LICENSE");
    expect(packOutput).toContain("README.md");
    expect(packOutput).toContain("dist/index.js");
    expect(packOutput).not.toContain(".DS_Store");
  }, 120000);

  it("produces a runnable built artifact before packing", async () => {
    const { stdout } = await execFile(
      process.execPath,
      [distEntryPath, "--help"],
      {
        cwd: rootDir,
      },
    );

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("exvex stress <solution> <brute> <generator>");
  }, 120000);
});
