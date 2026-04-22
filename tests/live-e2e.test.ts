import { execFile as execFileCallback } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { beforeAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const liveE2EEnabled = process.env.EXVEX_RUN_LIVE_E2E === "1";
const liveDescribe = liveE2EEnabled ? describe : describe.skip;
const cliPath = join(rootDir, "dist/index.js");

async function commandExists(command: string) {
  try {
    await execFile(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

liveDescribe("live CLI e2e", () => {
  beforeAll(async () => {
    await execFile(bunCommand, ["run", "build"], {
      cwd: rootDir,
    });
  }, 180000);

  it("runs javascript, python, and cpp programs through the built CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exvex-live-e2e-"));

    try {
      await writeFile(join(directory, "main.js"), "console.log('js-ok');\n");
      await writeFile(join(directory, "main.py"), "print('py-ok')\n");
      await writeFile(
        join(directory, "main.cpp"),
        [
          "#include <iostream>",
          "",
          "int main() {",
          '  std::cout << "cpp-ok" << std::endl;',
          "  return 0;",
          "}",
        ].join("\n"),
      );

      const jsResult = await execFile(process.execPath, [cliPath, "main.js"], {
        cwd: directory,
      });
      const pyResult = await execFile(process.execPath, [cliPath, "main.py"], {
        cwd: directory,
      });
      const cppResult = await execFile(
        process.execPath,
        [cliPath, "main.cpp"],
        {
          cwd: directory,
        },
      );

      expect(jsResult.stdout).toContain("js-ok");
      expect(pyResult.stdout).toContain("py-ok");
      expect(cppResult.stdout).toContain("cpp-ok");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);

  it("runs rust and ruby programs when their toolchains are available", async () => {
    const [hasRustc, hasRuby] = await Promise.all([
      commandExists("rustc"),
      commandExists("ruby"),
    ]);

    if (!hasRustc || !hasRuby) {
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), "exvex-live-extra-"));

    try {
      await writeFile(
        join(directory, "main.rs"),
        ["fn main() {", '    println!("rust-live-ok");', "}"].join("\n"),
      );
      await writeFile(join(directory, "main.rb"), "puts 'ruby-live-ok'\n");

      const rustResult = await execFile(
        process.execPath,
        [cliPath, "main.rs"],
        {
          cwd: directory,
        },
      );
      const rubyResult = await execFile(
        process.execPath,
        [cliPath, "main.rb"],
        {
          cwd: directory,
        },
      );

      expect(rustResult.stdout).toContain("rust-live-ok");
      expect(rubyResult.stdout).toContain("ruby-live-ok");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);

  it("runs php, java, and kotlin programs when their toolchains are available", async () => {
    const [hasPhp, hasJavac, hasJava, hasKotlinc] = await Promise.all([
      commandExists("php"),
      commandExists("javac"),
      commandExists("java"),
      commandExists("kotlinc"),
    ]);

    if (!hasPhp || !hasJavac || !hasJava || !hasKotlinc) {
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), "exvex-live-jvm-"));

    try {
      await writeFile(
        join(directory, "main.php"),
        "<?php\necho \"php-live-ok\\n\";\n",
      );
      await writeFile(
        join(directory, "Main.java"),
        [
          "public class Main {",
          "  public static void main(String[] args) {",
          '    System.out.println("java-live-ok");',
          "  }",
          "}",
        ].join("\n"),
      );
      await writeFile(
        join(directory, "Main.kt"),
        ['fun main() {', '    println("kotlin-live-ok")', "}"].join("\n"),
      );

      const phpResult = await execFile(
        process.execPath,
        [cliPath, "main.php"],
        {
          cwd: directory,
        },
      );
      const javaResult = await execFile(
        process.execPath,
        [cliPath, "Main.java"],
        {
          cwd: directory,
        },
      );
      const kotlinResult = await execFile(
        process.execPath,
        [cliPath, "Main.kt"],
        {
          cwd: directory,
        },
      );

      expect(phpResult.stdout).toContain("php-live-ok");
      expect(javaResult.stdout).toContain("java-live-ok");
      expect(kotlinResult.stdout).toContain("kotlin-live-ok");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
});
