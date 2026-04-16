import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHelpText,
  isCliEntrypoint,
  main,
  parseCliArgs,
  runCli,
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
    promptForArgs: vi.fn(async () => null),
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
});

describe("parseCliArgs", () => {
  it("returns help when no arguments are provided", () => {
    expect(parseCliArgs([])).toEqual({ help: true });
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

  it("rejects invalid stress iteration values", () => {
    expect(() =>
      parseCliArgs(["stress", "a.js", "b.js", "c.js", "--iterations=0"]),
    ).toThrow("--iterations must be at least 1.");
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
    expect(helpText).toContain("exvex.config.json");
    expect(helpText).toContain(".go");
    expect(helpText).toContain(".rb");
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

  it("returns 0 cleanly when the user cancels the interactive prompt", async () => {
    const { dependencies, logger } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => null),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(dependencies.runFile).not.toHaveBeenCalled();
    expect(dependencies.runJudge).not.toHaveBeenCalled();
    expect(dependencies.runStress).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("prints help when the interactive prompt chooses help", async () => {
    const { dependencies, logger } = createDependencies({
      isTty: true,
      promptForArgs: vi.fn(async () => []),
    });

    await expect(runCli([], dependencies)).resolves.toBe(0);

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
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
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 10,
        timeoutMs: 2000,
        timedOut: false,
      })),
    });

    await expect(runCli(["main.js"], dependencies)).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith("Process exited with code 1.");
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
    expect(
      isCliEntrypoint(["node", join(tmpdir(), "other-script.mjs")]),
    ).toBe(false);
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
