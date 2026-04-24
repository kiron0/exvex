import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../package.json";
import {
  formatRunCommand,
  formatStressCommand,
  formatTestCommand,
} from "../src/cli/commands";
import { initProject } from "../src/cli/init";
import {
  getHelpText,
  isCliEntrypoint,
  main,
  parseCliArgs,
  runCli,
  setPromptModuleLoaderForTests,
  type CliDependencies,
} from "../src/cli";

const PROJECT_DIR = join(tmpdir(), "exvex-cli-project");
const MAIN_FILE = join(PROJECT_DIR, "main.js");
const INPUT_DIR = join(PROJECT_DIR, "input");
const OUTPUT_DIR = join(PROJECT_DIR, "output");
const STRESS_ARTIFACT_DIR = join(PROJECT_DIR, ".exvex", "stress");

function createDependencies(overrides: Partial<CliDependencies> = {}) {
  const logger = {
    log: vi.fn(),
    error: vi.fn(),
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const dependencies: CliDependencies = {
    cwd: () => PROJECT_DIR,
    stdin,
    stdout,
    stderr,
    isTty: false,
    logger,
    runFile: vi.fn(async () => ({
      entryFile: MAIN_FILE,
      language: "javascript" as const,
      command: ["node", MAIN_FILE],
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 12,
      timeoutMs: 2000,
      timedOut: false,
    })),
    runJudge: vi.fn(async () => ({
      entryFile: MAIN_FILE,
      total: 2,
      passed: 2,
      failed: 0,
      cases: [
        {
          name: "1",
          inputPath: join(INPUT_DIR, "1.txt"),
          outputPath: join(OUTPUT_DIR, "1.txt"),
          passed: true,
          expected: "2\n",
          actual: "2\n",
          durationMs: 10,
          runResult: {
            entryFile: MAIN_FILE,
            language: "javascript" as const,
            command: ["node", MAIN_FILE],
            exitCode: 0,
            stdout: "2\n",
            stderr: "",
            durationMs: 10,
            timeoutMs: 2000,
            timedOut: false,
          },
        },
        {
          name: "2",
          inputPath: join(INPUT_DIR, "2.txt"),
          outputPath: join(OUTPUT_DIR, "2.txt"),
          passed: true,
          expected: "4\n",
          actual: "4\n",
          durationMs: 12,
          runResult: {
            entryFile: MAIN_FILE,
            language: "javascript" as const,
            command: ["node", MAIN_FILE],
            exitCode: 0,
            stdout: "4\n",
            stderr: "",
            durationMs: 12,
            timeoutMs: 2000,
            timedOut: false,
          },
        },
      ],
    })),
    runStress: vi.fn(async () => ({
      totalIterations: 10,
      completedIterations: 10,
      success: true,
    })),
    initProject: vi.fn(async () => ({
      cwd: PROJECT_DIR,
      language: "cpp" as const,
      preset: "test" as const,
      createdPaths: ["main.cpp", "input.txt", "output.txt"],
      overwrittenPaths: [],
      nextCommand: "npx exvex test main.cpp",
    })),
    promptForArgs: vi.fn(async () => null),
    promptForInitArgs: vi.fn(async () => null),
    ...overrides,
  };

  return {
    dependencies,
    logger,
    stdin,
    stdout,
    stderr,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  setPromptModuleLoaderForTests(undefined);
});

describe("parseCliArgs", () => {
  it("returns help when no arguments are provided", () => {
    expect(parseCliArgs([])).toEqual({ help: true });
  });

  it("parses version flags", () => {
    expect(parseCliArgs(["--version"])).toEqual({
      help: false,
      version: true,
    });
    expect(parseCliArgs(["-v"])).toEqual({
      help: false,
      version: true,
    });
  });

  it("parses run mode options", () => {
    expect(
      parseCliArgs([
        "main.cpp",
        "--input=sample.txt",
        "--timeout=5000",
        "--no-cache",
      ]),
    ).toEqual({
      help: false,
      command: "run",
      entryFile: "main.cpp",
      inputFile: "sample.txt",
      timeoutMs: 5000,
      useCache: false,
    });
  });

  it("parses run mode options with space-separated values", () => {
    expect(
      parseCliArgs([
        "main.cpp",
        "--input",
        "sample.txt",
        "--timeout",
        "5000",
        "--no-cache",
      ]),
    ).toEqual({
      help: false,
      command: "run",
      entryFile: "main.cpp",
      inputFile: "sample.txt",
      timeoutMs: 5000,
      useCache: false,
    });
  });

  it("allows dash-prefixed space-separated option values for file and dir paths", () => {
    expect(parseCliArgs(["main.cpp", "--input", "-sample.txt"])).toEqual({
      help: false,
      command: "run",
      entryFile: "main.cpp",
      inputFile: "-sample.txt",
      timeoutMs: undefined,
      useCache: true,
    });

    expect(
      parseCliArgs(["test", "--input-dir", "-in", "--output-dir", "-out"]),
    ).toEqual({
      help: false,
      command: "test",
      entryFile: undefined,
      inputDir: "-in",
      outputDir: "-out",
      timeoutMs: undefined,
      useCache: true,
    });

    expect(
      parseCliArgs([
        "init",
        "cpp",
        "--preset",
        "stress",
        "--solution",
        "-sol.cpp",
        "--brute",
        "-brute.cpp",
        "--generator",
        "-gen.cpp",
      ]),
    ).toEqual({
      help: false,
      command: "init",
      language: "cpp",
      preset: "stress",
      force: false,
      yes: false,
      contest: false,
      vscode: false,
      gitignore: false,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: undefined,
      solutionFile: "-sol.cpp",
      bruteFile: "-brute.cpp",
      generatorFile: "-gen.cpp",
    });

    expect(
      parseCliArgs(["init", "cpp", "--preset", "run", "--entry", "-main.cpp"]),
    ).toEqual({
      help: false,
      command: "init",
      language: "cpp",
      preset: "run",
      force: false,
      yes: false,
      contest: false,
      vscode: false,
      gitignore: false,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: "-main.cpp",
      solutionFile: undefined,
      bruteFile: undefined,
      generatorFile: undefined,
    });
  });

  it("parses --json in run, test, and stress modes", () => {
    expect(parseCliArgs(["main.js", "--json"])).toEqual({
      help: false,
      command: "run",
      entryFile: "main.js",
      inputFile: undefined,
      timeoutMs: undefined,
      useCache: true,
      json: true,
    });

    expect(parseCliArgs(["test", "--json"])).toEqual({
      help: false,
      command: "test",
      entryFile: undefined,
      inputDir: undefined,
      outputDir: undefined,
      timeoutMs: undefined,
      useCache: true,
      json: true,
    });

    expect(parseCliArgs(["stress", "a.js", "b.js", "c.js", "--json"])).toEqual({
      help: false,
      command: "stress",
      solutionFile: "a.js",
      bruteFile: "b.js",
      generatorFile: "c.js",
      iterations: undefined,
      timeoutMs: undefined,
      useCache: true,
      json: true,
    });
  });

  it("parses test mode options with an optional entry file", () => {
    expect(
      parseCliArgs([
        "test",
        "main.py",
        "--input-dir=samples/in",
        "--output-dir=samples/out",
        "--timeout=2500",
      ]),
    ).toEqual({
      help: false,
      command: "test",
      entryFile: "main.py",
      inputDir: "samples/in",
      outputDir: "samples/out",
      timeoutMs: 2500,
      useCache: true,
    });
  });

  it("parses test mode options with space-separated values", () => {
    expect(
      parseCliArgs([
        "test",
        "main.py",
        "--input-dir",
        "samples/in",
        "--output-dir",
        "samples/out",
        "--timeout",
        "2500",
      ]),
    ).toEqual({
      help: false,
      command: "test",
      entryFile: "main.py",
      inputDir: "samples/in",
      outputDir: "samples/out",
      timeoutMs: 2500,
      useCache: true,
    });
  });

  it("parses stress mode options", () => {
    expect(
      parseCliArgs([
        "stress",
        "solution.cpp",
        "brute.cpp",
        "gen.cpp",
        "--iterations=25",
        "--timeout=3000",
        "--no-cache",
      ]),
    ).toEqual({
      help: false,
      command: "stress",
      solutionFile: "solution.cpp",
      bruteFile: "brute.cpp",
      generatorFile: "gen.cpp",
      iterations: 25,
      timeoutMs: 3000,
      useCache: false,
    });
  });

  it("parses stress mode options with space-separated values", () => {
    expect(
      parseCliArgs([
        "stress",
        "solution.cpp",
        "brute.cpp",
        "gen.cpp",
        "--iterations",
        "25",
        "--timeout",
        "3000",
        "--no-cache",
      ]),
    ).toEqual({
      help: false,
      command: "stress",
      solutionFile: "solution.cpp",
      bruteFile: "brute.cpp",
      generatorFile: "gen.cpp",
      iterations: 25,
      timeoutMs: 3000,
      useCache: false,
    });
  });

  it("parses init mode options", () => {
    expect(
      parseCliArgs(["init", "cpp", "--stress", "--yes", "--force", "--json"]),
    ).toEqual({
      help: false,
      command: "init",
      language: "cpp",
      preset: "stress",
      force: true,
      yes: true,
      contest: false,
      vscode: false,
      gitignore: false,
      json: true,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: undefined,
      solutionFile: undefined,
      bruteFile: undefined,
      generatorFile: undefined,
    });

    expect(
      parseCliArgs([
        "init",
        "python",
        "--preset=run",
        "--contest",
        "--vscode",
        "--gitignore",
        "--entry=solve.py",
      ]),
    ).toEqual({
      help: false,
      command: "init",
      language: "python",
      preset: "run",
      force: false,
      yes: false,
      contest: true,
      vscode: true,
      gitignore: true,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: "solve.py",
      solutionFile: undefined,
      bruteFile: undefined,
      generatorFile: undefined,
    });
  });

  it("rejects unknown options", () => {
    expect(() => parseCliArgs(["main.cpp", "--device=desktop"])).toThrow(
      "Unknown option: --device=desktop",
    );
  });

  it("rejects missing run entries", () => {
    expect(() => parseCliArgs(["--timeout=1000"])).toThrow(
      "An entry file is required.",
    );
  });

  it("rejects empty option values in both option styles", () => {
    expect(() => parseCliArgs(["main.cpp", "--input="])).toThrow(
      "--input must not be empty.",
    );
    expect(() => parseCliArgs(["main.cpp", "--input"])).toThrow(
      "--input must not be empty.",
    );
  });

  it("does not swallow following option tokens as dash-prefixed values", () => {
    expect(() =>
      parseCliArgs(["main.cpp", "--input", "--timeout", "10"]),
    ).toThrow("--input must not be empty.");
    expect(() =>
      parseCliArgs(["test", "--input-dir", "--output-dir", "out", "main.cpp"]),
    ).toThrow("--input-dir must not be empty.");
    expect(() => parseCliArgs(["init", "cpp", "--entry", "--json"])).toThrow(
      "--entry must not be empty.",
    );
  });

  it("rejects invalid stress iteration values", () => {
    expect(() =>
      parseCliArgs(["stress", "a.js", "b.js", "c.js", "--iterations=0"]),
    ).toThrow("--iterations must be at least 1.");
  });

  it("rejects invalid init combinations", () => {
    expect(() => parseCliArgs(["init", "brainfuck"])).toThrow(
      'Unsupported init language: "brainfuck".',
    );
    expect(() => parseCliArgs(["init", "--preset=weird"])).toThrow(
      'Invalid init preset: "weird".',
    );
    expect(() =>
      parseCliArgs(["init", "cpp", "--stress", "--entry=main.cpp"]),
    ).toThrow("--entry cannot be used with stress init.");
    expect(() =>
      parseCliArgs(["init", "cpp", "--stress", "--input-dir=samples/in"]),
    ).toThrow("--input-dir and --output-dir cannot be used with stress init.");
    expect(() =>
      parseCliArgs(["init", "cpp", "--run", "--input-dir=samples/in"]),
    ).toThrow("--input-dir and --output-dir require --preset=test.");
  });

  it("validates negative numeric values for space-separated numeric options", () => {
    expect(() => parseCliArgs(["main.cpp", "--timeout", "-1"])).toThrow(
      "--timeout must be at least 0.",
    );
    expect(() =>
      parseCliArgs([
        "stress",
        "solution.js",
        "brute.js",
        "gen.js",
        "--iterations",
        "-1",
      ]),
    ).toThrow("--iterations must be at least 1.");
  });

  it("supports -- to end option parsing", () => {
    expect(parseCliArgs(["--", "--input"])).toEqual({
      help: false,
      command: "run",
      entryFile: "--input",
      inputFile: undefined,
      timeoutMs: undefined,
      useCache: true,
    });

    expect(parseCliArgs(["test", "--", "--mystery.py"])).toEqual({
      help: false,
      command: "test",
      entryFile: "--mystery.py",
      inputDir: undefined,
      outputDir: undefined,
      timeoutMs: undefined,
      useCache: true,
    });

    expect(
      parseCliArgs([
        "stress",
        "--iterations=2",
        "--",
        "--sol.py",
        "--brute.py",
        "--gen.py",
      ]),
    ).toEqual({
      help: false,
      command: "stress",
      solutionFile: "--sol.py",
      bruteFile: "--brute.py",
      generatorFile: "--gen.py",
      iterations: 2,
      timeoutMs: undefined,
      useCache: true,
    });
  });

  it("treats --help as a filename when it is not the first argument", () => {
    expect(parseCliArgs(["--", "--help"])).toEqual({
      help: false,
      command: "run",
      entryFile: "--help",
      inputFile: undefined,
      timeoutMs: undefined,
      useCache: true,
    });
  });

  it("shows help when --help appears before --", () => {
    expect(parseCliArgs(["test", "--help"])).toEqual({ help: true });
    expect(parseCliArgs(["main.js", "--help"])).toEqual({ help: true });
  });

  it("does not treat help or version flags as global when consumed as option values", () => {
    expect(parseCliArgs(["main.js", "--input", "--help"])).toEqual({
      help: false,
      command: "run",
      entryFile: "main.js",
      inputFile: "--help",
      timeoutMs: undefined,
      useCache: true,
    });

    expect(() => parseCliArgs(["main.js", "--timeout", "--version"])).toThrow(
      "--timeout must be an integer.",
    );
    expect(parseCliArgs(["init", "cpp", "--entry", "--help"])).toEqual({
      help: false,
      command: "init",
      language: "cpp",
      preset: undefined,
      force: false,
      yes: false,
      contest: false,
      vscode: false,
      gitignore: false,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: "--help",
      solutionFile: undefined,
      bruteFile: undefined,
      generatorFile: undefined,
    });
  });

  it("runs a file named 'test' when entry is after --", () => {
    expect(parseCliArgs(["--", "test"])).toEqual({
      help: false,
      command: "run",
      entryFile: "test",
      inputFile: undefined,
      timeoutMs: undefined,
      useCache: true,
    });
  });

  it("runs a file named 'stress' when entry is after --", () => {
    expect(parseCliArgs(["--timeout=500", "--", "stress"])).toEqual({
      help: false,
      command: "run",
      entryFile: "stress",
      inputFile: undefined,
      timeoutMs: 500,
      useCache: true,
    });
  });
});

describe("getHelpText", () => {
  it("includes the supported command surface", () => {
    const helpText = getHelpText();

    expect(helpText).toContain("exvex <entry>");
    expect(helpText).toContain("exvex test [entry]");
    expect(helpText).toContain("exvex stress <solution> <brute> <generator>");
    expect(helpText).toContain("exvex init [language]");
    expect(helpText).toContain("exvex --version");
    expect(helpText).toContain("exvex.config.json");
    expect(helpText).toContain("use 0 to disable timeout");
    expect(helpText).toContain(".exvex/cache");
    expect(helpText).toContain("--json");
    expect(helpText).toContain("--preset=NAME");
    expect(helpText).toContain("--contest");
    expect(helpText).toContain("--vscode");
    expect(helpText).toContain("--gitignore");
    expect(helpText).toContain("--version, -v");
    expect(helpText).toContain(".go");
    expect(helpText).toContain(".rb");
  });
});

describe("command formatters", () => {
  it("formats leading-dash run entries with -- separator", () => {
    expect(formatRunCommand("-solve.cpp")).toBe("npx exvex -- -solve.cpp");
  });

  it("formats shell-sensitive test paths deterministically", () => {
    expect(
      formatTestCommand("folder name/main.cpp", "samples in", "samples out"),
    ).toBe(
      'npx exvex test --input-dir="samples in" --output-dir="samples out" "folder name/main.cpp"',
    );
  });

  it("omits default single-file sample paths from test commands", () => {
    expect(formatTestCommand("main.cpp", "input.txt", "output.txt")).toBe(
      "npx exvex test main.cpp",
    );
  });

  it("escapes POSIX shell expansion characters in formatted commands", () => {
    const expectedRunCommand =
      process.platform === "win32"
        ? 'npx exvex "main$HOME`pwd`.cpp"'
        : 'npx exvex "main\\$HOME\\`pwd\\`.cpp"';
    const expectedStressCommand =
      process.platform === "win32"
        ? 'npx exvex stress "sol$1.cpp" brute.cpp gen.cpp'
        : 'npx exvex stress "sol\\$1.cpp" brute.cpp gen.cpp';

    expect(formatRunCommand("main$HOME`pwd`.cpp")).toBe(expectedRunCommand);
    expect(formatStressCommand("sol$1.cpp", "brute.cpp", "gen.cpp")).toBe(
      expectedStressCommand,
    );
  });

  it("formats stress paths with -- when any positional path starts with dash", () => {
    expect(
      formatStressCommand("solution.cpp", "-brute.cpp", "gen file.cpp"),
    ).toBe('npx exvex stress -- solution.cpp -brute.cpp "gen file.cpp"');
  });
});

describe("runCli", () => {
  it("prints help without invoking work", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(runCli(["--help"], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(dependencies.runFile).not.toHaveBeenCalled();
    expect(dependencies.runJudge).not.toHaveBeenCalled();
    expect(dependencies.runStress).not.toHaveBeenCalled();
    expect(dependencies.initProject).not.toHaveBeenCalled();
  });

  it("prints version without invoking work", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(runCli(["--version"], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(pkg.version);
    expect(dependencies.runFile).not.toHaveBeenCalled();
    expect(dependencies.runJudge).not.toHaveBeenCalled();
    expect(dependencies.runStress).not.toHaveBeenCalled();
    expect(dependencies.initProject).not.toHaveBeenCalled();
  });

  it("uses the interactive prompt when started without args in a TTY", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => ["main.rb", "--timeout=2500"]),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.promptForArgs).toHaveBeenCalled();
    expect(dependencies.runFile).toHaveBeenCalledWith(
      expect.objectContaining({
        entryFile: "main.rb",
        timeoutMs: 2500,
      }),
    );
  });

  it("routes interactive no-arg init mode to init scaffold", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => ["init", "cpp", "--preset=test"]),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.initProject).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "cpp",
        preset: "test",
      }),
    );
  });

  it("correctly routes an entry named 'test' from interactive run mode", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => ["--timeout=1000", "--", "test"]),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.runFile).toHaveBeenCalledWith(
      expect.objectContaining({
        entryFile: "test",
        timeoutMs: 1000,
      }),
    );
    expect(dependencies.runJudge).not.toHaveBeenCalled();
  });

  it("routes interactive test mode args to judge mode", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => ["test", "main.js", "--timeout=1000"]),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.runJudge).toHaveBeenCalledWith(
      expect.objectContaining({
        entryFile: "main.js",
        timeoutMs: 1000,
      }),
    );
  });

  it("routes interactive stress mode args to stress mode", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => [
        "stress",
        "solution.js",
        "brute.js",
        "gen.js",
        "--iterations=2",
      ]),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.runStress).toHaveBeenCalledWith(
      expect.objectContaining({
        solutionFile: "solution.js",
        bruteFile: "brute.js",
        generatorFile: "gen.js",
        iterations: 2,
      }),
    );
  });

  it("returns 0 cleanly when the user cancels the interactive prompt", async () => {
    const { dependencies, logger } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => null),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.runFile).not.toHaveBeenCalled();
    expect(dependencies.runJudge).not.toHaveBeenCalled();
    expect(dependencies.runStress).not.toHaveBeenCalled();
    expect(dependencies.initProject).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reports prompt loader failures cleanly", async () => {
    setPromptModuleLoaderForTests(async () => {
      throw new Error("prompt loader broke");
    });

    const { dependencies, logger } = createDependencies({
      isTty: true,
      promptForArgs: undefined,
    });

    await expect(runCli([], dependencies)).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith("Error: prompt loader broke");
  });

  it("retries prompt loading after a previous loader failure", async () => {
    let shouldFail = true;
    setPromptModuleLoaderForTests(async () => {
      if (shouldFail) {
        throw new Error("prompt loader broke");
      }

      return {
        intro: () => undefined,
        log: { message: () => undefined },
        outro: () => undefined,
        isCancel: () => false,
        select: async () => "help",
        confirm: async () => false,
        text: async () => "",
      } as never;
    });

    const first = createDependencies({
      isTty: true,
      promptForArgs: undefined,
    });
    await expect(runCli([], first.dependencies)).resolves.toBe(1);
    expect(first.logger.error).toHaveBeenCalledWith(
      "Error: prompt loader broke",
    );

    shouldFail = false;
    const second = createDependencies({
      isTty: true,
      promptForArgs: undefined,
    });
    await expect(runCli([], second.dependencies)).resolves.toBe(0);
    expect(second.logger.log).toHaveBeenCalledWith(getHelpText());
    expect(second.logger.error).not.toHaveBeenCalled();
  });

  it("prints help when the interactive prompt chooses help", async () => {
    const { dependencies, logger } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => []),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("uses init wizard when launched as bare init in a TTY", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForInitArgs: vi.fn(async () => [
        "init",
        "--json",
        "python",
        "--preset=run",
        "--entry=solve.py",
      ]),
    });

    await expect(runCli(["init"], dependencies)).resolves.toBe(0);

    expect(dependencies.promptForInitArgs).toHaveBeenCalled();
    expect(dependencies.initProject).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "python",
        preset: "run",
        entryFile: "solve.py",
      }),
    );
  });

  it("returns 0 when bare init wizard is cancelled", async () => {
    const { dependencies } = createDependencies({
      isTty: true,
      promptForInitArgs: vi.fn(async () => null),
    });

    await expect(runCli(["init"], dependencies)).resolves.toBe(0);

    expect(dependencies.initProject).not.toHaveBeenCalled();
  });

  it("invokes run mode with passthrough stdio", async () => {
    const { dependencies, stdin, stdout, stderr } = createDependencies();

    await expect(runCli(["main.js"], dependencies)).resolves.toBe(0);

    expect(dependencies.runFile).toHaveBeenCalledWith({
      entryFile: "main.js",
      cwd: PROJECT_DIR,
      inputFile: undefined,
      timeoutMs: undefined,
      useCache: true,
      stdin,
      stdout,
      stderr,
    });
  });

  it("omits stdin when an input file is provided", async () => {
    const { dependencies } = createDependencies();

    await expect(
      runCli(["main.js", "--input=sample.txt"], dependencies),
    ).resolves.toBe(0);

    expect(dependencies.runFile).toHaveBeenCalledWith(
      expect.objectContaining({
        inputFile: "sample.txt",
        stdin: null,
      }),
    );
  });

  it("prints judge summaries and returns a failing status when any case fails", async () => {
    const { dependencies, logger } = createDependencies({
      runJudge: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        total: 2,
        passed: 1,
        failed: 1,
        cases: [
          {
            name: "1",
            inputPath: join(INPUT_DIR, "1.txt"),
            outputPath: join(OUTPUT_DIR, "1.txt"),
            passed: true,
            expected: "2\n",
            actual: "2\n",
            durationMs: 10,
            runResult: {
              entryFile: MAIN_FILE,
              language: "javascript" as const,
              command: ["node", MAIN_FILE],
              exitCode: 0,
              stdout: "2\n",
              stderr: "",
              durationMs: 10,
              timeoutMs: 2000,
              timedOut: false,
            },
          },
          {
            name: "2",
            inputPath: join(INPUT_DIR, "2.txt"),
            outputPath: join(OUTPUT_DIR, "2.txt"),
            passed: false,
            expected: "4\n",
            actual: "5\n",
            durationMs: 11,
            diff: 'First difference at line 1, column 1: expected "4", received "5".',
            runResult: {
              entryFile: MAIN_FILE,
              language: "javascript" as const,
              command: ["node", MAIN_FILE],
              exitCode: 0,
              stdout: "5\n",
              stderr: "",
              durationMs: 11,
              timeoutMs: 2000,
              timedOut: false,
            },
          },
        ],
      })),
    });

    await expect(runCli(["test"], dependencies)).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith("Testing main.js against 2 cases.");
    expect(logger.log).toHaveBeenCalledWith("PASS 1 (10.0ms)");
    expect(logger.log).toHaveBeenCalledWith("FAIL 2 (11.0ms)");
    expect(logger.log).toHaveBeenCalledWith("Summary: 1/2 passed, 1 failed.");
  });

  it("prints clear runtime crash details in judge summaries", async () => {
    const { dependencies, logger } = createDependencies({
      runJudge: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        total: 1,
        passed: 0,
        failed: 1,
        cases: [
          {
            name: "1",
            inputPath: join(INPUT_DIR, "1.txt"),
            outputPath: join(OUTPUT_DIR, "1.txt"),
            passed: false,
            expected: "ok\n",
            actual: "",
            durationMs: 12,
            diff: "Program failed: access violation.",
            runResult: {
              entryFile: MAIN_FILE,
              language: "javascript" as const,
              command: ["node", MAIN_FILE],
              exitCode: 3221225477,
              stdout: "",
              stderr: "",
              durationMs: 12,
              timeoutMs: 2000,
              timedOut: false,
            },
          },
        ],
      })),
    });

    await expect(runCli(["test"], dependencies)).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      "  Program failed: access violation.",
    );
  });

  it("prints stress failures and returns a failing status", async () => {
    const { dependencies, logger } = createDependencies({
      runStress: vi.fn(async () => ({
        totalIterations: 100,
        completedIterations: 4,
        success: false,
        failureReason: "mismatch" as const,
        failingIteration: 5,
        message: "First difference at line 1, column 1.",
        artifactDir: STRESS_ARTIFACT_DIR,
      })),
    });

    await expect(
      runCli(["stress", "solution.js", "brute.js", "gen.js"], dependencies),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      "FAIL Stress test stopped at iteration 5.",
    );
    expect(logger.log).toHaveBeenCalledWith(
      `  Artifacts: ${STRESS_ARTIFACT_DIR}`,
    );
  });

  it("runs init mode and prints next steps", async () => {
    const { dependencies, logger } = createDependencies({
      initProject: vi.fn(async () => ({
        cwd: PROJECT_DIR,
        language: "cpp" as const,
        preset: "test" as const,
        createdPaths: ["main.cpp", "input.txt", "output.txt"],
        overwrittenPaths: [],
        nextCommand: "npx exvex test main.cpp",
      })),
    });

    await expect(runCli(["init", "cpp"], dependencies)).resolves.toBe(0);

    expect(dependencies.initProject).toHaveBeenCalledWith({
      cwd: PROJECT_DIR,
      language: "cpp",
      preset: "test",
      force: false,
      contest: false,
      vscode: false,
      gitignore: false,
      inputDir: undefined,
      outputDir: undefined,
      entryFile: undefined,
      solutionFile: undefined,
      bruteFile: undefined,
      generatorFile: undefined,
    });
    expect(logger.log).toHaveBeenCalledWith("Created files:");
    expect(logger.log).toHaveBeenCalledWith("Next:");
    expect(logger.log).toHaveBeenCalledWith("  npx exvex test main.cpp");
  });

  it("prints overwritten init paths in the text summary", async () => {
    const { dependencies, logger } = createDependencies({
      initProject: vi.fn(async () => ({
        cwd: PROJECT_DIR,
        language: "cpp" as const,
        preset: "test" as const,
        createdPaths: ["output.txt"],
        overwrittenPaths: ["main.cpp"],
        nextCommand: "npx exvex test main.cpp",
      })),
    });

    await expect(
      runCli(["init", "cpp", "--force"], dependencies),
    ).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith("Created/updated files:");
    expect(logger.log).toHaveBeenCalledWith("  output.txt");
    expect(logger.log).toHaveBeenCalledWith("  main.cpp");
  });

  it("prints init summaries as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies({
      initProject: vi.fn(async () => ({
        cwd: PROJECT_DIR,
        language: "cpp" as const,
        preset: "test" as const,
        createdPaths: ["main.cpp", "input.txt", "output.txt"],
        overwrittenPaths: [],
        nextCommand: "npx exvex test main.cpp",
      })),
    });

    await expect(runCli(["init", "cpp", "--json"], dependencies)).resolves.toBe(
      0,
    );

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"nextCommand": "npx exvex test main.cpp"'),
    );
  });

  it("returns a failing exit code when argument parsing fails", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(runCli(["stress", "solution.js"], dependencies)).resolves.toBe(
      1,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Stress mode requires exactly three files"),
    );
  });

  it("returns a failing exit code when a process fails", async () => {
    const { dependencies, logger } = createDependencies({
      runFile: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        language: "javascript" as const,
        command: ["node", MAIN_FILE],
        exitCode: 3221225477,
        stdout: "",
        stderr: "",
        durationMs: 10,
        timeoutMs: 2000,
        timedOut: false,
      })),
    });

    await expect(runCli(["main.js"], dependencies)).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      "Process failed: access violation.",
    );
  });

  it("prints run results as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies({
      runFile: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        language: "javascript" as const,
        command: ["node", MAIN_FILE],
        exitCode: 0,
        stdout: "json-ok\n",
        stderr: "",
        durationMs: 10,
        timeoutMs: 2000,
        timedOut: false,
      })),
    });

    await expect(runCli(["main.js", "--json"], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"stdout": "json-ok\\n"'),
    );
  });

  it("prints judge summaries as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(runCli(["test", "--json"], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"total": 2'),
    );
  });

  it("prints stress summaries as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(
        ["stress", "solution.js", "brute.js", "gen.js", "--json"],
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"success": true'),
    );
  });

  it("prints parse errors as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(["stress", "solution.js", "--json"], dependencies),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("classifies unexpected extra arguments as JSON parse errors", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(["test", "main.js", "extra", "--json"], dependencies),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"message": "Unexpected argument: extra"'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not force JSON mode when --json is consumed as an option value", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(["test", "--input-dir", "--json"], dependencies),
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      "Error: --input-dir must not be empty.",
    );
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining('"success": false'),
    );
  });

  it("prints init parse errors as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(["init", "brainfuck", "--json"], dependencies),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("classifies init path validation errors as JSON parse errors", async () => {
    const { dependencies, logger } = createDependencies({
      initProject: vi.fn(async () => {
        throw new Error("Entry file must stay inside current directory.");
      }),
    });

    await expect(
      runCli(["init", "cpp", "--entry", "../main.cpp", "--json"], dependencies),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '"message": "Entry file must stay inside current directory."',
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("classifies mixed init sample path errors as JSON parse errors", async () => {
    const { dependencies, logger } = createDependencies({
      initProject: vi.fn(async () => {
        throw new Error(
          "Input and output sample paths must both be .txt files or both be directories.",
        );
      }),
    });

    await expect(
      runCli(
        [
          "init",
          "cpp",
          "--preset=test",
          "--input-dir=input.txt",
          "--output-dir=output",
          "--json",
        ],
        dependencies,
      ),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '"message": "Input and output sample paths must both be .txt files or both be directories."',
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("classifies partial stress-init option errors as JSON parse errors", async () => {
    const { dependencies, logger } = createDependencies();

    await expect(
      runCli(
        ["init", "--preset=stress", "--solution=sol.cpp", "--json"],
        dependencies,
      ),
    ).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "ARG_PARSE_ERROR"'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Stress init requires --solution, --brute, and --generator together",
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("prints dependency errors as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies({
      runFile: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(runCli(["main.js", "--json"], dependencies)).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "CLI_ERROR"'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("prints config-load failures as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies({
      runFile: vi.fn(async () => {
        throw new Error("Failed to parse exvex.config.json: bad json");
      }),
    });

    await expect(runCli(["main.js", "--json"], dependencies)).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "CONFIG_ERROR"'),
    );
  });

  it("prints missing-toolchain failures as JSON when --json is used", async () => {
    const { dependencies, logger } = createDependencies({
      runFile: vi.fn(async () => {
        throw new Error(
          'Required command not found on PATH: "nope". Install the toolchain, add it to PATH, or override it in exvex.config.json.',
        );
      }),
    });

    await expect(runCli(["main.js", "--json"], dependencies)).resolves.toBe(1);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"code": "COMMAND_NOT_FOUND"'),
    );
  });

  it("keeps program stdout/stderr out of terminal streams in --json mode", async () => {
    const { dependencies, stdout, stderr, logger } = createDependencies({
      runFile: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        language: "javascript" as const,
        command: ["node", MAIN_FILE],
        exitCode: 0,
        stdout: "program-out\n",
        stderr: "program-err\n",
        durationMs: 10,
        timeoutMs: 2000,
        timedOut: false,
      })),
    });

    await expect(runCli(["main.js", "--json"], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('"stderr": "program-err\\n"'),
    );
    expect(stdout.read()).toBeNull();
    expect(stderr.read()).toBeNull();
  });
});

describe("initProject", () => {
  it("creates default test scaffold files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-test-"));

    try {
      const summary = await initProject({
        cwd,
        language: "cpp",
        preset: "test",
      });

      expect(summary.createdPaths).toEqual([
        "main.cpp",
        "input.txt",
        "output.txt",
      ]);
      expect(summary.nextCommand).toBe("npx exvex test main.cpp");
      expect(readFileSync(join(cwd, "main.cpp"), "utf8")).toContain(
        "#include <bits/stdc++.h>",
      );
      expect(readFileSync(join(cwd, "input.txt"), "utf8")).toBe("");
      expect(readFileSync(join(cwd, "output.txt"), "utf8")).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("creates single-file test scaffold files when sample paths are txt files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-test-inline-"));

    try {
      const summary = await initProject({
        cwd,
        language: "cpp",
        preset: "test",
        inputDir: "input.txt",
        outputDir: "output.txt",
      });

      expect(summary.createdPaths).toEqual([
        "main.cpp",
        "input.txt",
        "output.txt",
      ]);
      expect(summary.nextCommand).toBe("npx exvex test main.cpp");
      expect(readFileSync(join(cwd, "input.txt"), "utf8")).toBe("");
      expect(readFileSync(join(cwd, "output.txt"), "utf8")).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("creates contest scaffold with vscode tasks and gitignore", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-contest-"));

    try {
      const summary = await initProject({
        cwd,
        language: "python",
        preset: "test",
        contest: true,
        vscode: true,
        gitignore: true,
        inputDir: "samples/in",
        outputDir: "samples/out",
      });

      expect(summary.createdPaths).toContain("a/main.py");
      expect(summary.createdPaths).toContain("b/main.py");
      expect(summary.createdPaths).toContain("c/main.py");
      expect(summary.createdPaths).toContain(".vscode/tasks.json");
      expect(summary.createdPaths).toContain(".gitignore");
      expect(summary.nextCommand).toBe(
        "npx exvex test --input-dir=a/samples/in --output-dir=a/samples/out a/main.py",
      );
      expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain(
        ".exvex/",
      );
      const tasksJson = readFileSync(
        join(cwd, ".vscode", "tasks.json"),
        "utf8",
      );
      expect(tasksJson).toContain(
        '"command": "npx exvex test --input-dir=samples/in --output-dir=samples/out main.py"',
      );
      expect(tasksJson).toContain('"cwd": "${workspaceFolder}/a"');
      expect(
        readFileSync(join(cwd, "a", "samples", "in", "1.txt"), "utf8"),
      ).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses shell-independent nextCommand for contest stress scaffolds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-contest-stress-"));

    try {
      const summary = await initProject({
        cwd,
        language: "cpp",
        preset: "stress",
        contest: true,
      });

      expect(summary.nextCommand).toBe(
        "npx exvex stress a/solution.cpp a/brute.cpp a/gen.cpp",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appends .exvex/ to existing gitignore once", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-gitignore-"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");

    try {
      const first = await initProject({
        cwd,
        language: "cpp",
        preset: "run",
        gitignore: true,
      });
      const second = await initProject({
        cwd,
        language: "cpp",
        preset: "run",
        gitignore: true,
        force: true,
      });

      expect(first.overwrittenPaths).toContain(".gitignore");
      expect(second.overwrittenPaths).not.toContain(".gitignore");
      expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
        "node_modules/\n.exvex/\n",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails before writing scaffold files when .gitignore path is a directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-gitignore-dir-"));
    const gitignoreDir = join(cwd, ".gitignore");

    try {
      mkdirSync(gitignoreDir);

      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "run",
          gitignore: true,
        }),
      ).rejects.toThrow(
        'Cannot write file ".gitignore" because a directory already exists there.',
      );

      expect(() => readFileSync(join(cwd, "main.cpp"), "utf8")).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("creates stress scaffold files for java", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-stress-"));

    try {
      const summary = await initProject({
        cwd,
        language: "java",
        preset: "stress",
      });

      expect(summary.createdPaths).toEqual([
        "Solution.java",
        "Brute.java",
        "Gen.java",
      ]);
      expect(summary.nextCommand).toBe(
        "npx exvex stress Solution.java Brute.java Gen.java",
      );
      expect(readFileSync(join(cwd, "Solution.java"), "utf8")).toContain(
        "public class Solution",
      );
      expect(readFileSync(join(cwd, "Gen.java"), "utf8")).toContain(
        "System.out.println(0);",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing scaffold files without force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-conflict-"));
    writeFileSync(join(cwd, "main.py"), "print('keep')\n");

    try {
      await expect(
        initProject({
          cwd,
          language: "python",
          preset: "run",
          entryFile: "main.py",
        }),
      ).rejects.toThrow(
        'Refusing to overwrite existing file "main.py". Pass --force to overwrite scaffold files.',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("overwrites existing scaffold files with force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-force-"));
    writeFileSync(join(cwd, "main.rb"), "puts 'old'\n");

    try {
      const summary = await initProject({
        cwd,
        language: "ruby",
        preset: "run",
        entryFile: "main.rb",
        force: true,
      });

      expect(summary.createdPaths).toEqual([]);
      expect(summary.overwrittenPaths).toEqual(["main.rb"]);
      expect(readFileSync(join(cwd, "main.rb"), "utf8")).toContain(
        "main if __FILE__ == $PROGRAM_NAME",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports created and overwritten scaffold files separately in mixed force runs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-mixed-force-"));
    writeFileSync(join(cwd, "input.txt"), "");
    writeFileSync(join(cwd, "main.py"), "print('old')\n");

    try {
      const summary = await initProject({
        cwd,
        language: "python",
        preset: "test",
        entryFile: "main.py",
        force: true,
      });

      expect(summary.createdPaths).toEqual(["output.txt"]);
      expect(summary.overwrittenPaths).toEqual(["main.py", "input.txt"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("quotes shell-sensitive filenames in nextCommand", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-quote-next-"));

    try {
      const summary = await initProject({
        cwd,
        language: "cpp",
        preset: "run",
        entryFile: "main&1.cpp",
      });

      expect(summary.nextCommand).toBe('npx exvex "main&1.cpp"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("quotes shell-sensitive filenames in vscode tasks", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-quote-vscode-"));

    try {
      await initProject({
        cwd,
        language: "python",
        preset: "test",
        vscode: true,
        entryFile: "solve&go.py",
      });

      expect(
        readFileSync(join(cwd, ".vscode", "tasks.json"), "utf8"),
      ).toContain('npx exvex test \\"solve&go.py\\"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("escapes POSIX shell expansion characters in generated nextCommand and vscode tasks", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-shell-expand-"));

    try {
      const summary = await initProject({
        cwd,
        language: "python",
        preset: "test",
        vscode: true,
        entryFile: "solve$HOME.py",
        inputDir: "samples`in",
        outputDir: "samples$out",
      });

      if (process.platform === "win32") {
        expect(summary.nextCommand).toBe(
          'npx exvex test --input-dir="samples`in" --output-dir="samples$out" "solve$HOME.py"',
        );
        expect(
          readFileSync(join(cwd, ".vscode", "tasks.json"), "utf8"),
        ).toContain(
          'npx exvex test --input-dir=\\"samples`in\\" --output-dir=\\"samples$out\\" \\"solve$HOME.py\\"',
        );
      } else {
        expect(summary.nextCommand).toBe(
          'npx exvex test --input-dir="samples\\`in" --output-dir="samples\\$out" "solve\\$HOME.py"',
        );
        expect(
          readFileSync(join(cwd, ".vscode", "tasks.json"), "utf8"),
        ).toContain(
          'npx exvex test --input-dir=\\"samples\\\\`in\\" --output-dir=\\"samples\\\\$out\\" \\"solve\\\\$HOME.py\\"',
        );
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("normalizes vscode task paths to match scaffolded directories", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-vscode-normalize-"));

    try {
      await initProject({
        cwd,
        language: "python",
        preset: "test",
        vscode: true,
        inputDir: "./samples\\in",
        outputDir: ".\\samples/out",
        entryFile: "./solve.py",
      });

      const tasksJson = readFileSync(
        join(cwd, ".vscode", "tasks.json"),
        "utf8",
      );
      expect(tasksJson).toContain(
        '"command": "npx exvex test --input-dir=samples/in --output-dir=samples/out solve.py"',
      );
      expect(readFileSync(join(cwd, "samples", "in", "1.txt"), "utf8")).toBe(
        "",
      );
      expect(readFileSync(join(cwd, "samples", "out", "1.txt"), "utf8")).toBe(
        "",
      );
      expect(readFileSync(join(cwd, "solve.py"), "utf8")).toContain(
        "def main():",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects directory traversal in scaffold paths", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-traversal-"));

    try {
      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "run",
          entryFile: "../main.cpp",
        }),
      ).rejects.toThrow("Entry file must stay inside current directory.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects current-directory scaffold paths", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-current-dir-path-"));

    try {
      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "test",
          inputDir: ".",
        }),
      ).rejects.toThrow("Input path must not be empty.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects test scaffold when input path parent is a file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-input-parent-"));
    writeFileSync(join(cwd, "input.txt"), "occupied\n");

    try {
      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "test",
        }),
      ).rejects.toThrow(
        'Refusing to overwrite existing file "input.txt". Pass --force to overwrite scaffold files.',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports single-file sample paths in interactive test prompts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-interactive-test-files-"));
    writeFileSync(join(cwd, "main.cpp"), "#include <iostream>\n");
    writeFileSync(join(cwd, "input.txt"), "1\n");
    writeFileSync(join(cwd, "output.txt"), "2\n");

    const promptModule = {
      intro: () => undefined,
      log: { message: () => undefined },
      outro: () => undefined,
      isCancel: () => false,
      select: vi.fn().mockResolvedValueOnce("test"),
      confirm: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
      text: vi
        .fn()
        .mockResolvedValueOnce("main.cpp")
        .mockResolvedValueOnce("input.txt")
        .mockResolvedValueOnce("output.txt")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(""),
    };

    setPromptModuleLoaderForTests(async () => promptModule as never);
    const { dependencies } = createDependencies({
      cwd: () => cwd,
      isTty: true,
      promptForArgs: undefined,
    });

    try {
      await expect(runCli([], dependencies)).resolves.toBe(0);

      expect(dependencies.runJudge).toHaveBeenCalledWith(
        expect.objectContaining({
          entryFile: "main.cpp",
          inputDir: "input.txt",
          outputDir: "output.txt",
        }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects mixed file and directory sample paths for test scaffolds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-mixed-samples-"));

    try {
      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "test",
          inputDir: "input.txt",
          outputDir: "output",
        }),
      ).rejects.toThrow(
        "Input and output sample paths must both be .txt files or both be directories.",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects vscode scaffold when .vscode path is a file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "exvex-init-vscode-parent-"));
    writeFileSync(join(cwd, ".vscode"), "occupied\n");

    try {
      await expect(
        initProject({
          cwd,
          language: "cpp",
          preset: "run",
          vscode: true,
        }),
      ).rejects.toThrow(
        'Cannot create directory ".vscode" because a file already exists there.',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  it("does not exit on success", async () => {
    const { dependencies } = createDependencies();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new Error(`unexpected exit:${code}`);
    }) as never);

    await expect(main(["--help"], dependencies)).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits with the failing exit code", async () => {
    const { dependencies } = createDependencies({
      runFile: vi.fn(async () => ({
        entryFile: MAIN_FILE,
        language: "javascript" as const,
        command: ["node", MAIN_FILE],
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 10,
        timeoutMs: 2000,
        timedOut: false,
      })),
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    await expect(main(["main.js"], dependencies)).rejects.toThrow(
      "process.exit:1",
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("isCliEntrypoint", () => {
  it("returns false when there is no executable path", () => {
    expect(isCliEntrypoint(["node"])).toBe(false);
  });

  it("returns false for another script path", () => {
    expect(isCliEntrypoint(["node", join(tmpdir(), "other-script.mjs")])).toBe(
      false,
    );
  });

  it("returns true for the current module path", () => {
    const modulePath = join(tmpdir(), "exvex-cli.mjs");
    const moduleUrl = pathToFileURL(modulePath).href;

    expect(isCliEntrypoint(["node", modulePath], moduleUrl)).toBe(true);
  });

  it("returns true when the executable path is a symlink", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "exvex-cli-test-"));
    const realPath = join(tempDir, "real-cli.mjs");
    const symlinkPath = join(tempDir, "linked-cli.mjs");

    try {
      writeFileSync(realPath, "");
      try {
        symlinkSync(
          realPath,
          symlinkPath,
          process.platform === "win32" ? "file" : undefined,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          return;
        }

        throw error;
      }

      expect(
        isCliEntrypoint(["node", symlinkPath], pathToFileURL(realPath).href),
      ).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
