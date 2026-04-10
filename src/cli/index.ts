#!/usr/bin/env node

import {
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  text,
} from "@clack/prompts";
import pkg from "../../package.json";
import { realpathSync, statSync } from "fs";
import { basename } from "path";
import type { Readable, Writable } from "stream";
import { fileURLToPath, pathToFileURL } from "url";
import type { JudgeSummary, RunRequest, StressSummary } from "../interface";
import { formatDurationMs, runFile, runJudge, runStress } from "../lib";

const CANCEL_MESSAGE = "Thanks for using exvex..!";

type CliLogger = Pick<Console, "error" | "log">;

type ParsedCliArgs =
  | {
      help: true;
    }
  | {
      help: false;
      command: "run";
      entryFile: string;
      inputFile?: string;
      timeoutMs?: number;
      useCache: boolean;
    }
  | {
      help: false;
      command: "test";
      entryFile?: string;
      inputDir?: string;
      outputDir?: string;
      timeoutMs?: number;
      useCache: boolean;
    }
  | {
      help: false;
      command: "stress";
      solutionFile: string;
      bruteFile: string;
      generatorFile: string;
      iterations?: number;
      timeoutMs?: number;
      useCache: boolean;
    };

export interface CliDependencies {
  cwd: () => string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  isTty: boolean;
  logger: CliLogger;
  runFile: typeof runFile;
  runJudge: typeof runJudge;
  runStress: typeof runStress;
  promptForArgs?: () => Promise<string[] | null>;
}

const defaultCliDependencies: CliDependencies = {
  cwd: () => process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  isTty: Boolean(process.stdout.isTTY),
  logger: console,
  runFile,
  runJudge,
  runStress,
};

/** Returns the collected CLI args, or `null` if the user cancelled. */
async function promptForInteractiveArgs(): Promise<string[] | null> {
  intro(`exvex  v${pkg.version}`);
  log.message(pkg.description);

  const mode = await select({
    message: "Mode",
    options: [
      { value: "run", label: "Run a file", hint: "exvex <entry>" },
      {
        value: "test",
        label: "Judge against sample cases",
        hint: "exvex test [entry]",
      },
      {
        value: "stress",
        label: "Stress test against brute-force",
        hint: "exvex stress <solution> <brute> <generator>",
      },
      { value: "help", label: "Show help" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (isCancel(mode) || mode === "exit") {
    outro(CANCEL_MESSAGE);
    return null;
  }

  if (mode === "help") {
    return [];
  }

  const validateInteger =
    (min: number) =>
    (val: string | undefined): string | undefined => {
      if (!val) return undefined;
      if (!/^\d+$/.test(val)) return "Must be a whole number.";
      if (Number(val) < min) return `Must be at least ${min}.`;
      return undefined;
    };

  const statOf = (p: string) => {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  };

  /** Required field that must point to an existing regular file. */
  const validateRequiredFile = (v: string | undefined): string | undefined => {
    if (!v) return "Required.";
    const s = statOf(v);
    if (!s) return `File not found: "${v}"`;
    if (!s.isFile()) return `Not a file: "${v}"`;
    return undefined;
  };

  /** Optional field — skipped when blank; checks existence when provided. */
  const validateOptionalFile = (v: string | undefined): string | undefined => {
    if (!v) return undefined;
    const s = statOf(v);
    if (!s) return `File not found: "${v}"`;
    if (!s.isFile()) return `Not a file: "${v}"`;
    return undefined;
  };

  /** Optional directory field — skipped when blank; checks existence when provided. */
  const validateOptionalDir = (v: string | undefined): string | undefined => {
    if (!v) return undefined;
    const s = statOf(v);
    if (!s) return `Directory not found: "${v}"`;
    if (!s.isDirectory()) return `Not a directory: "${v}"`;
    return undefined;
  };

  if (mode === "stress") {
    const solution = await text({
      message: "Solution file",
      validate: validateRequiredFile,
    });
    if (isCancel(solution)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const brute = await text({
      message: "Brute-force file",
      validate: validateRequiredFile,
    });
    if (isCancel(brute)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const generator = await text({
      message: "Generator file",
      validate: validateRequiredFile,
    });
    if (isCancel(generator)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const iterations = await text({
      message: "Iterations",
      placeholder: "blank for default",
      validate: validateInteger(1),
    });
    if (isCancel(iterations)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const timeout = await text({
      message: "Timeout in ms",
      placeholder: "blank for default",
      validate: validateInteger(0),
    });
    if (isCancel(timeout)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const noCache = await confirm({
      message: "Disable compile cache?",
      initialValue: false,
    });
    if (isCancel(noCache)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    return [
      "stress",
      ...(iterations ? [`--iterations=${iterations}`] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
      ...(noCache ? ["--no-cache"] : []),
      "--",
      solution,
      brute,
      generator,
    ];
  }

  if (mode === "test") {
    const entry = await text({
      message: "Entry file",
      placeholder: "blank for auto-detect",
      validate: validateOptionalFile,
    });
    if (isCancel(entry)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const inputDir = await text({
      message: "Input directory",
      placeholder: "blank for default",
      validate: validateOptionalDir,
    });
    if (isCancel(inputDir)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const outputDir = await text({
      message: "Output directory",
      placeholder: "blank for default",
      validate: validateOptionalDir,
    });
    if (isCancel(outputDir)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const timeout = await text({
      message: "Timeout in ms",
      placeholder: "blank for default",
      validate: validateInteger(0),
    });
    if (isCancel(timeout)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const noCache = await confirm({
      message: "Disable compile cache?",
      initialValue: false,
    });
    if (isCancel(noCache)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    return [
      "test",
      ...(inputDir ? [`--input-dir=${inputDir}`] : []),
      ...(outputDir ? [`--output-dir=${outputDir}`] : []),
      ...(timeout ? [`--timeout=${timeout}`] : []),
      ...(noCache ? ["--no-cache"] : []),
      ...(entry ? ["--", entry] : []),
    ];
  }

  // run mode
  const entry = await text({
    message: "Entry file",
    validate: validateRequiredFile,
  });
  if (isCancel(entry)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const inputFile = await text({
    message: "Input file",
    placeholder: "blank to use stdin",
    validate: validateOptionalFile,
  });
  if (isCancel(inputFile)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const timeout = await text({
    message: "Timeout in ms",
    placeholder: "blank for default",
    validate: validateInteger(0),
  });
  if (isCancel(timeout)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const noCache = await confirm({
    message: "Disable compile cache?",
    initialValue: false,
  });
  if (isCancel(noCache)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  return [
    ...(inputFile ? [`--input=${inputFile}`] : []),
    ...(timeout ? [`--timeout=${timeout}`] : []),
    ...(noCache ? ["--no-cache"] : []),
    "--",
    entry,
  ];
}

function parseIntegerOption(
  optionName: string,
  value: string,
  { min = 0 }: { min?: number } = {},
) {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${optionName} must be an integer.`);
  }

  const parsed = Number(value);

  if (parsed < min) {
    throw new Error(`${optionName} must be at least ${min}.`);
  }

  return parsed;
}

function parseOptionValue(
  args: string[],
  index: number,
  optionName: string,
  { allowDashPrefixed = false }: { allowDashPrefixed?: boolean } = {},
) {
  const arg = args[index]!;
  const inlinePrefix = `${optionName}=`;

  if (arg === optionName) {
    const nextValue = args[index + 1];

    if (!nextValue || (!allowDashPrefixed && nextValue.startsWith("-"))) {
      throw new Error(`${optionName} must not be empty.`);
    }

    return {
      value: nextValue,
      nextIndex: index + 1,
    };
  }

  if (arg.startsWith(inlinePrefix)) {
    const value = arg.slice(inlinePrefix.length);

    if (!value) {
      throw new Error(`${optionName} must not be empty.`);
    }

    return {
      value,
      nextIndex: index,
    };
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function colorize(
  value: string,
  color: "green" | "red" | "yellow" | "cyan",
  enabled: boolean,
) {
  if (!enabled) {
    return value;
  }

  const colors = {
    green: "\u001b[32m",
    red: "\u001b[31m",
    yellow: "\u001b[33m",
    cyan: "\u001b[36m",
  } as const;

  return `${colors[color]}${value}\u001b[0m`;
}

function parseRunArgs(args: string[]): ParsedCliArgs {
  let entryFile: string | undefined;
  let inputFile: string | undefined;
  let timeoutMs: number | undefined;
  let useCache = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      const remaining = args.slice(index + 1);

      if (!entryFile) {
        if (remaining.length === 0) {
          throw new Error("An entry file is required.");
        }

        entryFile = remaining[0];

        if (remaining.length > 1) {
          throw new Error(`Unexpected argument: ${remaining[1]}`);
        }
      } else if (remaining.length > 0) {
        throw new Error(`Unexpected argument: ${remaining[0]}`);
      }

      break;
    }

    if (arg === "--no-cache") {
      useCache = false;
      continue;
    }

    const inputOption = parseOptionValue(args, index, "--input");
    if (inputOption) {
      inputFile = inputOption.value;
      index = inputOption.nextIndex;
      continue;
    }

    const timeoutOption = parseOptionValue(args, index, "--timeout", {
      allowDashPrefixed: true,
    });
    if (timeoutOption) {
      timeoutMs = parseIntegerOption("--timeout", timeoutOption.value);
      index = timeoutOption.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!entryFile) {
      entryFile = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!entryFile) {
    throw new Error("An entry file is required.");
  }

  return {
    help: false,
    command: "run",
    entryFile,
    inputFile,
    timeoutMs,
    useCache,
  };
}

function parseTestArgs(args: string[]): ParsedCliArgs {
  let entryFile: string | undefined;
  let inputDir: string | undefined;
  let outputDir: string | undefined;
  let timeoutMs: number | undefined;
  let useCache = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      const remaining = args.slice(index + 1);
      const hadEntryBefore = Boolean(entryFile);

      if (!entryFile && remaining.length > 0) {
        entryFile = remaining[0];
      }

      if (hadEntryBefore ? remaining.length > 0 : remaining.length > 1) {
        throw new Error(
          `Unexpected argument: ${hadEntryBefore ? remaining[0] : remaining[1]}`,
        );
      }

      break;
    }

    if (arg === "--no-cache") {
      useCache = false;
      continue;
    }

    const inputDirOption = parseOptionValue(args, index, "--input-dir");
    if (inputDirOption) {
      inputDir = inputDirOption.value;
      index = inputDirOption.nextIndex;
      continue;
    }

    const outputDirOption = parseOptionValue(args, index, "--output-dir");
    if (outputDirOption) {
      outputDir = outputDirOption.value;
      index = outputDirOption.nextIndex;
      continue;
    }

    const timeoutOption = parseOptionValue(args, index, "--timeout", {
      allowDashPrefixed: true,
    });
    if (timeoutOption) {
      timeoutMs = parseIntegerOption("--timeout", timeoutOption.value);
      index = timeoutOption.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!entryFile) {
      entryFile = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return {
    help: false,
    command: "test",
    entryFile,
    inputDir,
    outputDir,
    timeoutMs,
    useCache,
  };
}

function parseStressArgs(args: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  let iterations: number | undefined;
  let timeoutMs: number | undefined;
  let useCache = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg === "--no-cache") {
      useCache = false;
      continue;
    }

    const iterationsOption = parseOptionValue(args, index, "--iterations", {
      allowDashPrefixed: true,
    });
    if (iterationsOption) {
      iterations = parseIntegerOption("--iterations", iterationsOption.value, {
        min: 1,
      });
      index = iterationsOption.nextIndex;
      continue;
    }

    const timeoutOption = parseOptionValue(args, index, "--timeout", {
      allowDashPrefixed: true,
    });
    if (timeoutOption) {
      timeoutMs = parseIntegerOption("--timeout", timeoutOption.value);
      index = timeoutOption.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length !== 3) {
    throw new Error(
      "Stress mode requires exactly three files: <solution> <brute> <generator>.",
    );
  }

  return {
    help: false,
    command: "stress",
    solutionFile: positionals[0],
    bruteFile: positionals[1],
    generatorFile: positionals[2],
    iterations,
    timeoutMs,
    useCache,
  };
}

export function getHelpText() {
  return `
Usage:
  exvex <entry> [--input=FILE] [--timeout=MS] [--no-cache]
  exvex test [entry] [--input-dir=DIR] [--output-dir=DIR] [--timeout=MS] [--no-cache]
  exvex stress <solution> <brute> <generator> [--iterations=N] [--timeout=MS] [--no-cache]
  exvex --help

Commands:
  <entry>          Run a supported source file directly
  test             Run sample tests from input/output directories
  stress           Compare a solution against a brute-force implementation

Options:
  --input=FILE     Feed input from a file in run mode (also: --input FILE)
  --input-dir=DIR  Input directory for judge mode (also: --input-dir DIR)
  --output-dir=DIR Output directory for judge mode (also: --output-dir DIR)
  --iterations=N   Number of stress iterations (default: 100; also: --iterations N)
  --timeout=MS     Override execution timeout in milliseconds (also: --timeout MS)
  --               Stop option parsing; treat following args as positional values
  --no-cache       Disable compile cache for this invocation
  --help, -h       Show this help

Supported extensions:
  .c, .cpp, .py, .java, .js, .go, .rs, .kt, .php, .rb

Configuration:
  exvex reads exvex.config.json from the current working directory when present.
`.trim();
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args.length === 0) {
    return { help: true };
  }

  const endOfOptionsIndex = args.indexOf("--");
  const argsForHelpCheck =
    endOfOptionsIndex >= 0 ? args.slice(0, endOfOptionsIndex) : args;
  if (argsForHelpCheck.includes("--help") || argsForHelpCheck.includes("-h")) {
    return { help: true };
  }

  const [command, ...rest] = args;

  if (command === "test") {
    return parseTestArgs(rest);
  }

  if (command === "stress") {
    return parseStressArgs(rest);
  }

  return parseRunArgs(args);
}

function logJudgeSummary(
  summary: JudgeSummary,
  logger: CliLogger,
  isTty: boolean,
) {
  logger.log(
    `Testing ${basename(summary.entryFile)} against ${summary.total} case${
      summary.total === 1 ? "" : "s"
    }.`,
  );

  for (const result of summary.cases) {
    logger.log(
      `${colorize(result.passed ? "PASS" : "FAIL", result.passed ? "green" : "red", isTty)} ${result.name} (${formatDurationMs(result.durationMs)})`,
    );

    if (!result.passed && result.diff) {
      logger.log(`  ${result.diff}`);
    }
  }

  logger.log(
    `Summary: ${summary.passed}/${summary.total} passed, ${summary.failed} failed.`,
  );
}

function logStressSummary(
  summary: StressSummary,
  logger: CliLogger,
  isTty: boolean,
) {
  if (summary.success) {
    logger.log(
      `${colorize("PASS", "green", isTty)} ${summary.completedIterations}/${summary.totalIterations} iteration(s) completed without mismatches.`,
    );
    return;
  }

  logger.log(
    `${colorize("FAIL", "red", isTty)} Stress test stopped at iteration ${summary.failingIteration}.`,
  );

  if (summary.message) {
    logger.log(`  ${summary.message}`);
  }

  if (summary.artifactDir) {
    logger.log(`  Artifacts: ${summary.artifactDir}`);
  }
}

function logRunFailure(
  result: Awaited<ReturnType<typeof runFile>>,
  logger: CliLogger,
  isTty: boolean,
) {
  if (result.timedOut) {
    logger.error(
      colorize(`Timed out after ${result.timeoutMs}ms.`, "red", isTty),
    );
    return;
  }

  logger.error(
    colorize(
      `Process exited with code ${result.exitCode ?? "unknown"}.`,
      "red",
      isTty,
    ),
  );

  const stderr = result.stderr.trim();

  if (stderr) {
    logger.error(stderr);
  }
}

export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultCliDependencies,
) {
  const { logger } = dependencies;

  try {
    let parsedArgs: string[] | undefined;

    if (args.length === 0 && dependencies.isTty) {
      const interactiveArgs = await (dependencies.promptForArgs
        ? dependencies.promptForArgs()
        : promptForInteractiveArgs());

      // null means the user cancelled the interactive prompt
      if (interactiveArgs === null) {
        return 0;
      }

      parsedArgs = interactiveArgs;
    }

    const parsed = parseCliArgs(parsedArgs ?? args);

    if (parsed.help) {
      logger.log(getHelpText());
      return 0;
    }

    if (parsed.command === "run") {
      const runRequest: RunRequest = {
        entryFile: parsed.entryFile,
        cwd: dependencies.cwd(),
        inputFile: parsed.inputFile,
        timeoutMs: parsed.timeoutMs,
        useCache: parsed.useCache,
        stdin: parsed.inputFile ? null : dependencies.stdin,
        stdout: dependencies.stdout,
        stderr: dependencies.stderr,
      };
      const result = await dependencies.runFile(runRequest);

      if (result.timedOut || result.exitCode !== 0) {
        logRunFailure(result, logger, dependencies.isTty);
        return 1;
      }

      return 0;
    }

    if (parsed.command === "test") {
      const summary = await dependencies.runJudge({
        entryFile: parsed.entryFile,
        cwd: dependencies.cwd(),
        inputDir: parsed.inputDir,
        outputDir: parsed.outputDir,
        timeoutMs: parsed.timeoutMs,
        useCache: parsed.useCache,
      });

      logJudgeSummary(summary, logger, dependencies.isTty);
      return summary.failed === 0 ? 0 : 1;
    }

    const summary = await dependencies.runStress({
      solutionFile: parsed.solutionFile,
      bruteFile: parsed.bruteFile,
      generatorFile: parsed.generatorFile,
      cwd: dependencies.cwd(),
      iterations: parsed.iterations,
      timeoutMs: parsed.timeoutMs,
      useCache: parsed.useCache,
    });

    logStressSummary(summary, logger, dependencies.isTty);
    return summary.success ? 0 : 1;
  } catch (error) {
    logger.error(`Error: ${getErrorMessage(error)}`);
    return 1;
  }
}

export async function main(
  args: string[] = process.argv.slice(2),
  dependencies: CliDependencies = defaultCliDependencies,
) {
  const exitCode = await runCli(args, dependencies);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export function isCliEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
) {
  const entryPath = argv[1];

  if (!entryPath) {
    return false;
  }

  const normalizePathToHref = (path: string) => {
    try {
      return pathToFileURL(realpathSync(path)).href;
    } catch {
      return pathToFileURL(path).href;
    }
  };

  try {
    const modulePath =
      moduleUrl.startsWith("file:") ? fileURLToPath(moduleUrl) : moduleUrl;

    return normalizePathToHref(entryPath) === normalizePathToHref(modulePath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  void main();
}
