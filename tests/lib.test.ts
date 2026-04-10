import { execFileSync } from "child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCacheKey,
  detectLanguageForFile,
  describeFirstDifference,
  loadConfig,
  normalizeOutput,
  resolveEntryFile,
  runFile,
  runJudge,
  runStress,
  writeStressArtifacts,
} from "../src/lib";
import { splitCommand } from "../src/utils";

const tempDirs: string[] = [];
const hasGo = commandExists("go");
const hasRustc = commandExists("rustc");
const hasJava = commandExists("javac") && commandExists("java");
const hasKotlinc = commandExists("kotlinc") && commandExists("java");
const hasRuby = commandExists("ruby");

function commandExists(command: string) {
  try {
    // Use /bin/sh (always available) rather than /bin/zsh (absent on Ubuntu CI).
    execFileSync("/bin/sh", ["-c", `command -v ${command}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function getProcessesMatching(marker: string) {
  const output = execFileSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(marker))
    .map((line) => {
      const firstSpaceIndex = line.indexOf(" ");
      const pid = Number(line.slice(0, firstSpaceIndex));
      const args = line.slice(firstSpaceIndex + 1);

      return { pid, args };
    })
    .filter((entry) => Number.isInteger(entry.pid));
}

async function createTempDir(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("loadConfig", () => {
  it("merges local config with defaults", async () => {
    const directory = await createTempDir("exvex-config-");

    await writeFile(
      join(directory, "exvex.config.json"),
      JSON.stringify(
        {
          timeout: 4500,
          javascript: "node --trace-warnings",
          rust: "rustc -O -g",
          ruby: "ruby --disable-gems",
        },
        null,
        2,
      ),
    );

    await expect(loadConfig(directory)).resolves.toMatchObject({
      timeout: 4500,
      javascript: "node --trace-warnings",
      rust: "rustc -O -g",
      ruby: "ruby --disable-gems",
      cpp: "g++ -O2 -std=c++17",
      inputDir: "input",
      outputDir: "output",
    });
  });

  it("rejects non-object top-level config values", async () => {
    const directory = await createTempDir("exvex-config-invalid-");

    await writeFile(join(directory, "exvex.config.json"), '"node"');

    await expect(loadConfig(directory)).rejects.toThrow(
      "top-level JSON value must be an object",
    );
  });

  it("rejects a directory named exvex.config.json with a clear error", async () => {
    const directory = await createTempDir("exvex-config-dir-");
    await mkdir(join(directory, "exvex.config.json"));

    await expect(loadConfig(directory)).rejects.toThrow(
      "exvex.config.json must be a file, not a directory.",
    );
  });

  it("parses config files that include a UTF-8 BOM", async () => {
    const directory = await createTempDir("exvex-config-bom-");
    const bomPrefixedJson = `\uFEFF${JSON.stringify({ timeout: 3500 })}`;

    await writeFile(join(directory, "exvex.config.json"), bomPrefixedJson);

    await expect(loadConfig(directory)).resolves.toMatchObject({
      timeout: 3500,
    });
  });
});

describe("resolveEntryFile", () => {
  it("prefers a single main.* source file", async () => {
    const directory = await createTempDir("exvex-entry-");

    await writeFile(join(directory, "helper.py"), "print('helper')\n");
    await writeFile(join(directory, "main.js"), "console.log('main')\n");

    await expect(resolveEntryFile(directory)).resolves.toBe(
      join(directory, "main.js"),
    );
  });

  it("prefers Main.java for Java workflows", async () => {
    const directory = await createTempDir("exvex-entry-java-");

    await writeFile(
      join(directory, "Main.java"),
      "public class Main { public static void main(String[] args) {} }\n",
    );
    await writeFile(join(directory, "helper.py"), "print('helper')\n");

    await expect(resolveEntryFile(directory)).resolves.toBe(
      join(directory, "Main.java"),
    );
  });

  it("prefers an extensionless main file detected from its shebang", async () => {
    const directory = await createTempDir("exvex-entry-main-shebang-");

    await writeFile(
      join(directory, "main"),
      "#!/usr/bin/env node\nconsole.log('main')\n",
    );
    await writeFile(join(directory, "helper.rb"), "puts 'helper'\n");

    await expect(resolveEntryFile(directory)).resolves.toBe(
      join(directory, "main"),
    );
  });

  it("rejects multiple non-main candidates", async () => {
    const directory = await createTempDir("exvex-entry-");

    await writeFile(join(directory, "a.js"), "console.log('a')\n");
    await writeFile(join(directory, "b.py"), "print('b')\n");

    await expect(resolveEntryFile(directory)).rejects.toThrow(
      "Multiple runnable files found",
    );
  });

  it("detects extensionless scripts with a shebang", async () => {
    const directory = await createTempDir("exvex-entry-shebang-");
    const entryPath = join(directory, "main");

    await writeFile(entryPath, "#!/usr/bin/env node\nconsole.log('hello')\n");

    await expect(resolveEntryFile(directory, "main")).resolves.toBe(entryPath);
    await expect(detectLanguageForFile(entryPath)).resolves.toBe("javascript");
  });

  it("rejects an explicit entry path that is a directory", async () => {
    const directory = await createTempDir("exvex-entry-directory-");
    const entryDirectory = join(directory, "main.cpp");
    await mkdir(entryDirectory);

    await expect(resolveEntryFile(directory, "main.cpp")).rejects.toThrow(
      "Entry file must be a file",
    );
  });

  it("detects extensionless C++ sources with common C++ headers", async () => {
    const directory = await createTempDir("exvex-entry-cpp-content-");
    const entryPath = join(directory, "main");

    await writeFile(
      entryPath,
      [
        "#include <bits/stdc++.h>",
        "",
        "using namespace std;",
        "",
        "int main() {",
        "  cout << 42 << '\\n';",
        "}",
      ].join("\n"),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("cpp");
  });

  it("detects extensionless C++ sources that use namespace std", async () => {
    const directory = await createTempDir("exvex-entry-cpp-namespace-");
    const entryPath = join(directory, "main");

    await writeFile(
      entryPath,
      [
        "#include <cstdio>",
        "",
        "using namespace std;",
        "",
        "int main() {",
        '  printf("ok\\n");',
        "}",
      ].join("\n"),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("cpp");
  });

  it("does not misidentify extensionless JS files using require() as Ruby", async () => {
    const directory = await createTempDir("exvex-entry-js-require-");
    const entryPath = join(directory, "main");

    await writeFile(
      entryPath,
      [
        'const fs = require("fs");',
        'const path = require("path");',
        "fs.readFileSync(path.join(__dirname, 'data.txt'));",
      ].join("\n"),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("javascript");
  });

  it("does not misidentify a bare require() at line start as Ruby", async () => {
    const directory = await createTempDir("exvex-entry-js-bare-require-");
    const entryPath = join(directory, "main");

    await writeFile(
      entryPath,
      ['require("dotenv").config();', "console.log(process.env.HOME);"].join(
        "\n",
      ),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("javascript");
  });

  it("still detects extensionless Ruby files using require", async () => {
    const directory = await createTempDir("exvex-entry-rb-require-");
    const entryPath = join(directory, "main");

    await writeFile(
      entryPath,
      ["require 'json'", "puts JSON.parse(STDIN.read)[0]"].join("\n"),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("ruby");
  });
});

describe("output helpers", () => {
  it("normalizes line endings and trailing whitespace", () => {
    expect(normalizeOutput("hello\r\nworld \n\n")).toBe("hello\nworld");
  });

  it("normalizes standalone carriage returns", () => {
    expect(normalizeOutput("hello\rworld\r")).toBe("hello\nworld");
  });

  it("treats standalone \\r output as matching \\n output when judging", () => {
    expect(normalizeOutput("42\r")).toBe(normalizeOutput("42\n"));
  });

  it("describes the first difference between outputs", () => {
    expect(describeFirstDifference("42\n", "45\n")).toBe(
      'First difference at line 1, column 2: expected "42", received "45".',
    );
  });
});

describe("sortCaseNames", () => {
  it("sorts numerically so 10 comes after 9", async () => {
    const { sortCaseNames } = await import("../src/utils");
    expect(sortCaseNames(["10", "9", "1", "2"])).toEqual(["1", "2", "9", "10"]);
  });

  it("sorts case-distinctly so 1a and 1A have stable distinct order", async () => {
    const { sortCaseNames } = await import("../src/utils");
    const sorted = sortCaseNames(["1A", "1a"]);
    expect(sorted).toHaveLength(2);
    expect(sorted[0]).not.toBe(sorted[1]);
  });
});

describe("buildCacheKey", () => {
  it("changes when the source signature changes", () => {
    const first = buildCacheKey({
      entryPath: "/tmp/main.cpp",
      sourceSignature: "/tmp/main.cpp:100",
      compileCommand: "g++ -O2 -std=c++17",
    });
    const second = buildCacheKey({
      entryPath: "/tmp/main.cpp",
      sourceSignature: "/tmp/main.cpp:200",
      compileCommand: "g++ -O2 -std=c++17",
    });

    expect(first).not.toBe(second);
  });

  it("changes when the compile command changes", () => {
    const first = buildCacheKey({
      entryPath: "/tmp/main.cpp",
      sourceSignature: "/tmp/main.cpp:100",
      compileCommand: "g++ -O2 -std=c++17",
    });
    const second = buildCacheKey({
      entryPath: "/tmp/main.cpp",
      sourceSignature: "/tmp/main.cpp:100",
      compileCommand: "g++ -O3 -std=c++20",
    });

    expect(first).not.toBe(second);
  });
});

describe("splitCommand", () => {
  it("parses quoted arguments with spaces", () => {
    expect(splitCommand('python3 -c "print(\\"hello world\\")"')).toEqual([
      "python3",
      "-c",
      'print("hello world")',
    ]);
  });

  it("parses escaped spaces in unquoted tokens", () => {
    expect(splitCommand("my\\ command --flag")).toEqual([
      "my command",
      "--flag",
    ]);
  });

  it("throws when command contains an unmatched quote", () => {
    expect(() => splitCommand('node -e "console.log(1)')).toThrow(
      "Invalid command: unmatched",
    );
  });

  it("preserves backslashes in unquoted Windows-like paths", () => {
    expect(splitCommand("C:\\Tools\\python.exe -V")).toEqual([
      "C:\\Tools\\python.exe",
      "-V",
    ]);
  });

  it("preserves backslashes in quoted Windows-like paths", () => {
    expect(splitCommand('"C:\\Program Files\\Python\\python.exe" -V')).toEqual([
      "C:\\Program Files\\Python\\python.exe",
      "-V",
    ]);
  });
});

describe("writeStressArtifacts", () => {
  it("persists failing input and outputs", async () => {
    const directory = await createTempDir("exvex-stress-artifacts-");

    const artifacts = await writeStressArtifacts({
      cwd: directory,
      inputText: "1\n",
      solutionOutput: "2\n",
      bruteOutput: "3\n",
    });

    await expect(readFile(artifacts.failingInputPath, "utf8")).resolves.toBe(
      "1\n",
    );
    await expect(readFile(artifacts.solutionOutputPath, "utf8")).resolves.toBe(
      "2\n",
    );
    await expect(readFile(artifacts.bruteOutputPath, "utf8")).resolves.toBe(
      "3\n",
    );
  });
});

describe("runJudge", () => {
  it("passes matching sample cases with normalized output", async () => {
    const directory = await createTempDir("exvex-judge-");

    await writeFile(
      join(directory, "main.js"),
      [
        "const fs = require('node:fs');",
        "const value = Number(fs.readFileSync(0, 'utf8').trim());",
        "console.log(String(value * 2));",
      ].join("\n"),
    );
    await mkdir(join(directory, "input"));
    await mkdir(join(directory, "output"));
    await writeFile(join(directory, "input/1.txt"), "21\n");
    await writeFile(join(directory, "output/1.txt"), "42\r\n");

    const summary = await runJudge({
      cwd: directory,
      entryFile: "main.js",
    });

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.cases[0]?.passed).toBe(true);
  });

  it("fails fast when inputs and outputs are not fully paired", async () => {
    const directory = await createTempDir("exvex-judge-mismatch-");

    await writeFile(join(directory, "main.js"), "console.log('ok');\n");
    await mkdir(join(directory, "input"));
    await mkdir(join(directory, "output"));
    await writeFile(join(directory, "input/1.txt"), "21\n");
    await writeFile(join(directory, "input/2.txt"), "25\n");
    await writeFile(join(directory, "output/1.txt"), "42\n");

    await expect(
      runJudge({
        cwd: directory,
        entryFile: "main.js",
      }),
    ).rejects.toThrow("Judge case directories are incomplete");
  });

  it("rejects non-directory judge paths with clear errors", async () => {
    const directory = await createTempDir("exvex-judge-dir-type-");

    await writeFile(join(directory, "main.js"), "console.log('ok');\n");
    await writeFile(join(directory, "input.txt"), "1\n");
    await mkdir(join(directory, "output"));
    await writeFile(join(directory, "output/1.txt"), "ok\n");

    await expect(
      runJudge({
        cwd: directory,
        entryFile: "main.js",
        inputDir: "input.txt",
        outputDir: "output",
      }),
    ).rejects.toThrow("Input directory must be a directory");
  });
});

describe("runFile", () => {
  it("rejects a missing input file with a clear error", async () => {
    const directory = await createTempDir("exvex-runfile-inputfile-");
    await writeFile(join(directory, "main.js"), "console.log('ok');\n");

    await expect(
      runFile({
        cwd: directory,
        entryFile: "main.js",
        inputFile: "no-such-file.txt",
      }),
    ).rejects.toThrow("Input file not found");
  });

  it("rejects empty entry file values", async () => {
    const directory = await createTempDir("exvex-runfile-empty-entry-");
    await writeFile(join(directory, "main.js"), "console.log('ok');\n");

    await expect(
      runFile({
        cwd: directory,
        entryFile: "",
      }),
    ).rejects.toThrow("Entry file must not be empty.");
  });

  it("rejects negative timeout values", async () => {
    const directory = await createTempDir("exvex-runfile-timeout-");
    await writeFile(join(directory, "main.js"), "console.log('ok');\n");

    await expect(
      runFile({
        cwd: directory,
        entryFile: "main.js",
        timeoutMs: -1,
      }),
    ).rejects.toThrow("timeoutMs must be a non-negative integer.");
  });

  it("includes an extensionless Go file in compilation sources rather than throwing 'No go sources found'", async () => {
    const directory = await createTempDir("exvex-go-extensionless-");
    const entryPath = join(directory, "solution");

    await writeFile(
      entryPath,
      [
        "package main",
        "",
        'import "fmt"',
        "",
        "func main() {",
        '  fmt.Println("hello")',
        "}",
      ].join("\n"),
    );

    await expect(detectLanguageForFile(entryPath)).resolves.toBe("go");

    if (hasGo) {
      const result = await runFile({
        cwd: directory,
        entryFile: "solution",
        timeoutMs: 15000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    } else {
      // Without Go installed the error should be "command not found", proving
      // we reached the compilation step rather than failing with the old
      // misleading "No go sources found" error.
      await expect(
        runFile({ cwd: directory, entryFile: "solution", timeoutMs: 5000 }),
      ).rejects.toThrow(/not found on PATH|No go sources found/);

      // Specifically ensure the old "No go sources found" message is gone.
      await expect(
        runFile({ cwd: directory, entryFile: "solution", timeoutMs: 5000 }),
      ).rejects.not.toThrow("No go sources found");
    }
  });

  it("cleans temporary artifacts created by --no-cache", async () => {
    const directory = await createTempDir("exvex-runfile-");

    await writeFile(
      join(directory, "main.cpp"),
      [
        "#include <iostream>",
        "",
        "int main() {",
        '  std::cout << "ok" << std::endl;',
        "  return 0;",
        "}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: false,
      timeoutMs: 10000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
    await expect(
      rm(result.artifactPath ?? "", { recursive: true, force: false }),
    ).rejects.toThrow();
  });

  it("invalidates the compile cache when source contents change with preserved timestamps", async () => {
    const directory = await createTempDir("exvex-cache-");
    const entryPath = join(directory, "main.cpp");

    await writeFile(
      entryPath,
      [
        "#include <iostream>",
        "int main() {",
        '  std::cout << "first" << std::endl;',
        "  return 0;",
        "}",
      ].join("\n"),
    );

    const firstResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });
    const originalStat = await stat(entryPath);

    await writeFile(
      entryPath,
      [
        "#include <iostream>",
        "int main() {",
        '  std::cout << "second" << std::endl;',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    await utimes(entryPath, originalStat.atime, originalStat.mtime);

    const secondResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });

    expect(firstResult.stdout).toContain("first");
    expect(secondResult.stdout).toContain("second");
  });

  it("invalidates the C++ cache when a local header changes", async () => {
    const directory = await createTempDir("exvex-cpp-header-cache-");

    await writeFile(
      join(directory, "helper.hpp"),
      ["#pragma once", "", '#define EXVEX_MESSAGE "header-first"'].join("\n"),
    );
    await writeFile(
      join(directory, "main.cpp"),
      [
        "#include <iostream>",
        '#include "helper.hpp"',
        "",
        "int main() {",
        "  std::cout << EXVEX_MESSAGE << std::endl;",
        "  return 0;",
        "}",
      ].join("\n"),
    );

    const firstResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });

    await writeFile(
      join(directory, "helper.hpp"),
      ["#pragma once", "", '#define EXVEX_MESSAGE "header-second"'].join("\n"),
    );

    const secondResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });

    expect(firstResult.stdout).toContain("header-first");
    expect(secondResult.stdout).toContain("header-second");
  });

  it("invalidates the C++ cache when a nested local header changes", async () => {
    const directory = await createTempDir("exvex-cpp-nested-header-cache-");

    await mkdir(join(directory, "include"));
    await writeFile(
      join(directory, "include", "helper.hpp"),
      ["#pragma once", "", '#define EXVEX_NESTED_MESSAGE "nested-first"'].join(
        "\n",
      ),
    );
    await writeFile(
      join(directory, "main.cpp"),
      [
        "#include <iostream>",
        '#include "include/helper.hpp"',
        "",
        "int main() {",
        "  std::cout << EXVEX_NESTED_MESSAGE << std::endl;",
        "  return 0;",
        "}",
      ].join("\n"),
    );

    const firstResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });

    await writeFile(
      join(directory, "include", "helper.hpp"),
      ["#pragma once", "", '#define EXVEX_NESTED_MESSAGE "nested-second"'].join(
        "\n",
      ),
    );

    const secondResult = await runFile({
      cwd: directory,
      entryFile: "main.cpp",
      useCache: true,
      timeoutMs: 10000,
    });

    expect(firstResult.stdout).toContain("nested-first");
    expect(secondResult.stdout).toContain("nested-second");
  });

  it("kills descendant processes when a run times out", async () => {
    const directory = await createTempDir("exvex-timeout-");
    const marker = `exvex-timeout-marker-${Date.now()}`;

    await writeFile(
      join(directory, "main.js"),
      [
        "const { spawn } = require('node:child_process');",
        `const marker = ${JSON.stringify(marker)};`,
        "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {",
        "  stdio: 'ignore',",
        "});",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.js",
      timeoutMs: 150,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const lingeringProcesses = getProcessesMatching(marker);

    try {
      expect(result.timedOut).toBe(true);
      expect(lingeringProcesses).toHaveLength(0);
    } finally {
      for (const processInfo of lingeringProcesses) {
        try {
          process.kill(processInfo.pid, "SIGKILL");
        } catch {
          // Ignore already-terminated processes.
        }
      }
    }
  });

  const rustIt = hasRustc ? it : it.skip;
  const goIt = hasGo ? it : it.skip;
  const javaIt = hasJava ? it : it.skip;
  goIt("runs multi-file go sources end to end", async () => {
    const directory = await createTempDir("exvex-go-");

    await writeFile(
      join(directory, "main.go"),
      ["package main", "func main() {", "    printMessage()", "}"].join("\n"),
    );
    await writeFile(
      join(directory, "helper.go"),
      [
        "package main",
        'import "fmt"',
        "",
        "func printMessage() {",
        '    fmt.Println("go-ok")',
        "}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.go",
      timeoutMs: 10000,
    });

    expect(result.language).toBe("go");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("go-ok");
  });

  goIt("ignores _test.go files when building a Go program", async () => {
    const directory = await createTempDir("exvex-go-testfiles-");

    await writeFile(
      join(directory, "main.go"),
      [
        "package main",
        'import "fmt"',
        "",
        "func main() {",
        '    fmt.Println("go-main-ok")',
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(directory, "helper_test.go"),
      [
        "package main",
        "",
        'import "testing"',
        "",
        "func TestIgnored(t *testing.T) {}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.go",
      timeoutMs: 10000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("go-main-ok");
  });

  goIt("ignores nested Go files from subdirectories", async () => {
    const directory = await createTempDir("exvex-go-nested-dir-");
    const nestedDir = join(directory, "util");
    await mkdir(nestedDir, { recursive: true });

    await writeFile(
      join(directory, "main.go"),
      [
        "package main",
        'import "fmt"',
        "",
        "func main() {",
        '    fmt.Println("go-nested-ok")',
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(nestedDir, "helper.go"),
      [
        "package util",
        "",
        "func Hidden() string {",
        '    return "ignored"',
        "}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.go",
      timeoutMs: 10000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("go-nested-ok");
  });

  rustIt("runs rust sources end to end", async () => {
    const directory = await createTempDir("exvex-rust-");

    await writeFile(
      join(directory, "main.rs"),
      ["fn main() {", '    println!("rust-ok");', "}"].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "main.rs",
      timeoutMs: 10000,
    });

    expect(result.language).toBe("rust");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rust-ok");
  });

  rustIt(
    "invalidates the rust cache when a sibling module changes",
    async () => {
      const directory = await createTempDir("exvex-rust-cache-");

      await writeFile(
        join(directory, "main.rs"),
        [
          "mod helper;",
          "",
          "fn main() {",
          "    helper::print_message();",
          "}",
        ].join("\n"),
      );
      await writeFile(
        join(directory, "helper.rs"),
        ["pub fn print_message() {", '    println!("rust-first");', "}"].join(
          "\n",
        ),
      );

      const firstResult = await runFile({
        cwd: directory,
        entryFile: "main.rs",
        useCache: true,
        timeoutMs: 10000,
      });

      await writeFile(
        join(directory, "helper.rs"),
        ["pub fn print_message() {", '    println!("rust-second");', "}"].join(
          "\n",
        ),
      );

      const secondResult = await runFile({
        cwd: directory,
        entryFile: "main.rs",
        useCache: true,
        timeoutMs: 10000,
      });

      expect(firstResult.stdout).toContain("rust-first");
      expect(secondResult.stdout).toContain("rust-second");
    },
  );

  javaIt("runs java sources that declare a package", async () => {
    const directory = await createTempDir("exvex-java-package-");
    const packageDir = join(directory, "demo");
    await mkdir(packageDir);

    await writeFile(
      join(packageDir, "Main.java"),
      [
        "package demo;",
        "",
        "public class Main {",
        "  public static void main(String[] args) {",
        '    System.out.println("java-package-ok");',
        "  }",
        "}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "demo/Main.java",
      timeoutMs: 15000,
    });

    expect(result.language).toBe("java");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("java-package-ok");
  });

  javaIt("runs java sources with nested package dependencies", async () => {
    const directory = await createTempDir("exvex-java-nested-package-");
    const packageDir = join(directory, "demo");
    const utilDir = join(packageDir, "util");
    await mkdir(utilDir, { recursive: true });

    await writeFile(
      join(packageDir, "Main.java"),
      [
        "package demo;",
        "",
        "import demo.util.Helper;",
        "",
        "public class Main {",
        "  public static void main(String[] args) {",
        "    System.out.println(Helper.message());",
        "  }",
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(utilDir, "Helper.java"),
      [
        "package demo.util;",
        "",
        "public class Helper {",
        "  public static String message() {",
        '    return "java-nested-ok";',
        "  }",
        "}",
      ].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "demo/Main.java",
      timeoutMs: 15000,
    });

    expect(result.language).toBe("java");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("java-nested-ok");
  });

  const kotlinIt = hasKotlinc ? it : it.skip;
  kotlinIt("runs multi-file kotlin sources end to end", async () => {
    const directory = await createTempDir("exvex-kotlin-");

    await writeFile(
      join(directory, "Main.kt"),
      ["fun main() {", "    printMessage()", "}"].join("\n"),
    );
    await writeFile(
      join(directory, "Helper.kt"),
      ["fun printMessage() {", '    println("kt-ok")', "}"].join("\n"),
    );

    const result = await runFile({
      cwd: directory,
      entryFile: "Main.kt",
      timeoutMs: 15000,
    });

    expect(result.language).toBe("kotlin");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("kt-ok");
  });

  const rubyIt = hasRuby ? it : it.skip;
  rubyIt("runs ruby sources end to end", async () => {
    const directory = await createTempDir("exvex-ruby-");

    await writeFile(join(directory, "main.rb"), "puts 'ruby-ok'\n");

    const result = await runFile({
      cwd: directory,
      entryFile: "main.rb",
      timeoutMs: 5000,
    });

    expect(result.language).toBe("ruby");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ruby-ok");
  });

  it("reports a missing runtime command with a config hint", async () => {
    const directory = await createTempDir("exvex-missing-tool-");

    await writeFile(join(directory, "main.rb"), "puts 'ignored'\n");
    await writeFile(
      join(directory, "exvex.config.json"),
      JSON.stringify({ ruby: "definitely-missing-ruby-command" }, null, 2),
    );

    await expect(
      runFile({
        cwd: directory,
        entryFile: "main.rb",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(
      'Required command not found on PATH: "definitely-missing-ruby-command". Install the toolchain or override it in exvex.config.json.',
    );
  });
});

describe("runStress", () => {
  it("rejects empty required file values", async () => {
    await expect(
      runStress({
        solutionFile: "",
        bruteFile: "brute.js",
        generatorFile: "gen.js",
      }),
    ).rejects.toThrow("Entry file must not be empty.");
  });

  it("rejects non-positive iterations", async () => {
    await expect(
      runStress({
        solutionFile: "solution.js",
        bruteFile: "brute.js",
        generatorFile: "gen.js",
        iterations: 0,
      }),
    ).rejects.toThrow("iterations must be a positive integer.");
  });

  it("rejects negative timeout values", async () => {
    await expect(
      runStress({
        solutionFile: "solution.js",
        bruteFile: "brute.js",
        generatorFile: "gen.js",
        timeoutMs: -1,
      }),
    ).rejects.toThrow("timeoutMs must be a non-negative integer.");
  });

  it("stops on the first mismatch and writes artifacts", async () => {
    const directory = await createTempDir("exvex-stress-");

    await writeFile(
      join(directory, "solution.js"),
      [
        "const fs = require('node:fs');",
        "const value = fs.readFileSync(0, 'utf8').trim();",
        "console.log(value);",
      ].join("\n"),
    );
    await writeFile(
      join(directory, "brute.js"),
      [
        "const fs = require('node:fs');",
        "const value = Number(fs.readFileSync(0, 'utf8').trim());",
        "console.log(String(value + 1));",
      ].join("\n"),
    );
    await writeFile(join(directory, "gen.js"), "console.log('1');\n");

    const summary = await runStress({
      cwd: directory,
      solutionFile: "solution.js",
      bruteFile: "brute.js",
      generatorFile: "gen.js",
      iterations: 3,
      timeoutMs: 2000,
    });

    expect(summary.success).toBe(false);
    expect(summary.failureReason).toBe("mismatch");
    expect(summary.failingIteration).toBe(1);
    expect(summary.artifactDir).toBe(join(directory, ".exvex/stress"));
    await expect(
      readFile(join(directory, ".exvex/stress/failing-input.txt"), "utf8"),
    ).resolves.toBe("1\n");
  });
});
