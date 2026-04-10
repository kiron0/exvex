import { execFile as execFileCallback } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { beforeAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const bunDescribe = (await canRunBun()) ? describe : describe.skip;

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

bunDescribe("built CLI", () => {
  beforeAll(async () => {
    await execFile(bunCommand, ["run", "build"], {
      cwd: rootDir,
    });
  });

  it("prints help from the built artifact", async () => {
    const { stdout } = await execFile(
      process.execPath,
      ["dist/index.js", "--help"],
      {
        cwd: rootDir,
      },
    );

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("exvex test [entry]");
    expect(stdout).toContain(".go");
    expect(stdout).toContain(".rb");
  });

  it("returns a validation error from the built artifact", async () => {
    await expect(
      execFile(process.execPath, ["dist/index.js", "--unknown"], {
        cwd: rootDir,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Unknown option: --unknown"),
    });
  });
});
