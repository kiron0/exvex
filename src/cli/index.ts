import type * as ClackPrompts from "@clack/prompts";
import pkg from "../../package.json";
import { realpathSync, statSync } from "fs";
import { basename } from "path";
import type { Readable, Writable } from "stream";
import { fileURLToPath, pathToFileURL } from "url";
import type { JudgeSummary, RunRequest, StressSummary } from "../interface";
import {
  INIT_LANGUAGES,
  initProject,
  type InitLanguage,
  type InitPreset,
  type InitSummary,
} from "./init";
import { formatDurationMs, runFile, runJudge, runStress } from "../lib";
import { CONFIG_FILENAME, describeExitCode } from "../utils";

const CANCEL_MESSAGE = "Thanks for using exvex.";

type PromptModule = typeof ClackPrompts;

type CliLogger = Pick<Console, "error" | "log">;

type ParsedCliArgs =
  | {
      help: true;
    }
  | {
      help: false;
      version: true;
    }
  | {
      help: false;
      json?: boolean;
      command: "run";
      entryFile: string;
      inputFile?: string;
      timeoutMs?: number;
      useCache: boolean;
    }
  | {
      help: false;
      json?: boolean;
      command: "test";
      entryFile?: string;
      inputDir?: string;
      outputDir?: string;
      timeoutMs?: number;
      useCache: boolean;
    }
  | {
      help: false;
      json?: boolean;
      command: "stress";
      solutionFile: string;
      bruteFile: string;
      generatorFile: string;
      iterations?: number;
      timeoutMs?: number;
      useCache: boolean;
    }
  | {
      help: false;
      command: "init";
      json?: boolean;
      language?: InitLanguage;
      preset?: InitPreset;
      force: boolean;
      yes: boolean;
      contest: boolean;
      vscode: boolean;
      gitignore: boolean;
      inputDir?: string;
      outputDir?: string;
      entryFile?: string;
      solutionFile?: string;
      bruteFile?: string;
      generatorFile?: string;
    };

type ParsedCliVersionArgs = Extract<ParsedCliArgs, { version: true }>;
type ParsedCliCommandArgs = Extract<ParsedCliArgs, { command: string }>;

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
  initProject: typeof initProject;
  promptForArgs?: () => Promise<string[] | null>;
  promptForInitArgs?: () => Promise<string[] | null>;
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
  initProject,
};

let promptModulePromise: Promise<PromptModule> | undefined;
let promptModuleLoader: () => Promise<PromptModule> = () =>
  import("@clack/prompts");

async function loadPrompts(): Promise<PromptModule> {
  // Keep prompts bundled into dist/index.js. Published package has zero runtime deps.
  promptModulePromise ??= promptModuleLoader().catch((error) => {
    promptModulePromise = undefined;
    throw error;
  });
  return promptModulePromise;
}

export function setPromptModuleLoaderForTests(
  loader: (() => Promise<PromptModule>) | undefined,
) {
  promptModuleLoader = loader ?? (() => import("@clack/prompts"));
  promptModulePromise = undefined;
}

function assertPromptString(value: string | symbol, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Prompt cancelled while reading ${fieldName}.`);
  }

  return value;
}

function assertInitLanguage(value: string | symbol): InitLanguage {
  if (
    typeof value !== "string" ||
    !INIT_LANGUAGES.includes(value as InitLanguage)
  ) {
    throw new Error(`Unsupported init language: ${String(value)}`);
  }

  return value as InitLanguage;
}

function getDefaultInitEntryFile(language: InitLanguage) {
  if (language === "java" || language === "kotlin") {
    return `Main${language === "java" ? ".java" : ".kt"}`;
  }

  const extensions: Record<InitLanguage, string> = {
    c: ".c",
    cpp: ".cpp",
    python: ".py",
    java: ".java",
    javascript: ".js",
    go: ".go",
    rust: ".rs",
    kotlin: ".kt",
    php: ".php",
    ruby: ".rb",
  };

  return `main${extensions[language]}`;
}

function getDefaultInitStressFiles(language: InitLanguage) {
  const extensionMap: Record<InitLanguage, string> = {
    c: ".c",
    cpp: ".cpp",
    python: ".py",
    java: ".java",
    javascript: ".js",
    go: ".go",
    rust: ".rs",
    kotlin: ".kt",
    php: ".php",
    ruby: ".rb",
  };
  const extension = extensionMap[language];

  if (language === "java" || language === "kotlin") {
    return {
      solution: `Solution${extension}`,
      brute: `Brute${extension}`,
      generator: `Gen${extension}`,
    };
  }

  return {
    solution: `solution${extension}`,
    brute: `brute${extension}`,
    generator: `gen${extension}`,
  };
}

async function promptForInitCommandArgs(): Promise<string[] | null> {
  const { confirm, isCancel, outro, select, text } = await loadPrompts();

  const jsonOutput = await confirm({
    message: "Emit JSON output?",
    initialValue: false,
  });
  if (isCancel(jsonOutput)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const preset = await select({
    message: "Preset",
    initialValue: "test",
    options: [
      { value: "test", label: "Sample judge workspace", hint: "recommended" },
      { value: "run", label: "Single-file run workspace" },
      { value: "stress", label: "Stress-test workspace" },
    ],
  });

  if (isCancel(preset)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const language = await select({
    message: "Language",
    initialValue: "cpp",
    options: INIT_LANGUAGES.map((value) => ({
      value,
      label: value,
    })),
  });

  if (isCancel(language)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const selectedLanguage = assertInitLanguage(language);

  const force = await confirm({
    message: "Overwrite scaffold files if they already exist?",
    initialValue: false,
  });
  if (isCancel(force)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const contest = await confirm({
    message: "Create contest folders a/, b/, c/?",
    initialValue: false,
  });
  if (isCancel(contest)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const vscode = await confirm({
    message: "Generate .vscode/tasks.json?",
    initialValue: false,
  });
  if (isCancel(vscode)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const gitignore = await confirm({
    message: 'Append ".exvex/" to .gitignore?',
    initialValue: false,
  });
  if (isCancel(gitignore)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  if (preset === "stress") {
    const defaults = getDefaultInitStressFiles(selectedLanguage);

    const solution = await text({
      message: "Solution file",
      initialValue: defaults.solution,
      validate: (value) => (!value ? "Required." : undefined),
    });
    if (isCancel(solution)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const brute = await text({
      message: "Brute-force file",
      initialValue: defaults.brute,
      validate: (value) => (!value ? "Required." : undefined),
    });
    if (isCancel(brute)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const generator = await text({
      message: "Generator file",
      initialValue: defaults.generator,
      validate: (value) => (!value ? "Required." : undefined),
    });
    if (isCancel(generator)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    return [
      "init",
      ...(jsonOutput ? ["--json"] : []),
      selectedLanguage,
      "--preset=stress",
      ...(force ? ["--force"] : []),
      ...(contest ? ["--contest"] : []),
      ...(vscode ? ["--vscode"] : []),
      ...(gitignore ? ["--gitignore"] : []),
      `--solution=${solution}`,
      `--brute=${brute}`,
      `--generator=${generator}`,
    ];
  }

  const entryFile = await text({
    message: "Entry file",
    initialValue: getDefaultInitEntryFile(selectedLanguage),
    validate: (value) => (!value ? "Required." : undefined),
  });
  if (isCancel(entryFile)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

  const selectedEntryFile = assertPromptString(entryFile, "entry file");

  let inputDir: string | undefined;
  let outputDir: string | undefined;

  if (preset === "test") {
    const rawInputDir = await text({
      message: "Input path",
      initialValue: "input.txt",
      validate: (value) => (!value ? "Required." : undefined),
    });
    if (isCancel(rawInputDir)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    inputDir = assertPromptString(rawInputDir, "input path");

    const rawOutputDir = await text({
      message: "Output path",
      initialValue: "output.txt",
      validate: (value) => (!value ? "Required." : undefined),
    });
    if (isCancel(rawOutputDir)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    outputDir = assertPromptString(rawOutputDir, "output path");
  }

  return [
    "init",
    ...(jsonOutput ? ["--json"] : []),
    selectedLanguage,
    `--preset=${preset}`,
    ...(force ? ["--force"] : []),
    ...(contest ? ["--contest"] : []),
    ...(vscode ? ["--vscode"] : []),
    ...(gitignore ? ["--gitignore"] : []),
    ...(inputDir ? [`--input-dir=${inputDir}`] : []),
    ...(outputDir ? [`--output-dir=${outputDir}`] : []),
    `--entry=${selectedEntryFile}`,
  ];
}

/** Returns the collected CLI args, or `null` if the user cancelled. */
async function promptForInteractiveArgs(): Promise<string[] | null> {
  const { confirm, intro, isCancel, log, outro, select, text } =
    await loadPrompts();

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
      {
        value: "init",
        label: "Initialize workspace",
        hint: "exvex init",
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

  if (mode === "init") {
    return await promptForInitCommandArgs();
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
  const validateOptionalSamplePath = (
    v: string | undefined,
  ): string | undefined => {
    if (!v) return undefined;
    const s = statOf(v);
    if (!s) return `Path not found: "${v}"`;
    if (!s.isDirectory() && !s.isFile()) {
      return `Not a file or directory: "${v}"`;
    }
    return undefined;
  };

  const jsonOutput = await confirm({
    message: "Emit JSON output?",
    initialValue: false,
  });
  if (isCancel(jsonOutput)) {
    outro(CANCEL_MESSAGE);
    return null;
  }

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
      ...(jsonOutput ? ["--json"] : []),
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
      message: "Input path",
      placeholder: "blank for default",
      validate: validateOptionalSamplePath,
    });
    if (isCancel(inputDir)) {
      outro(CANCEL_MESSAGE);
      return null;
    }

    const outputDir = await text({
      message: "Output path",
      placeholder: "blank for default",
      validate: validateOptionalSamplePath,
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
      ...(jsonOutput ? ["--json"] : []),
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
    ...(jsonOutput ? ["--json"] : []),
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

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} must be a safe integer.`);
  }

  if (parsed < min) {
    throw new Error(`${optionName} must be at least ${min}.`);
  }

  return parsed;
}

function parseOptionValue(
  args: string[],
  index: number,
  optionName: string,
  {
    allowDashPrefixed = false,
    reservedOptions = [],
  }: { allowDashPrefixed?: boolean; reservedOptions?: string[] } = {},
) {
  const arg = args[index]!;
  const inlinePrefix = `${optionName}=`;

  if (arg === optionName) {
    const nextValue = args[index + 1];

    if (
      !nextValue ||
      nextValue === "--" ||
      (!allowDashPrefixed && nextValue.startsWith("-")) ||
      (allowDashPrefixed && reservedOptions.includes(nextValue))
    ) {
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
  let json = false;

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

    if (arg === "--json") {
      json = true;
      continue;
    }

    const inputOption = parseOptionValue(args, index, "--input", {
      allowDashPrefixed: true,
      reservedOptions: ["--input", "--timeout", "--json", "--no-cache", "--"],
    });
    if (inputOption) {
      inputFile = inputOption.value;
      index = inputOption.nextIndex;
      continue;
    }

    const timeoutOption = parseOptionValue(args, index, "--timeout", {
      allowDashPrefixed: true,
      reservedOptions: ["--input", "--timeout", "--json", "--no-cache", "--"],
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
    ...(json ? { json: true } : {}),
  };
}

function parseTestArgs(args: string[]): ParsedCliArgs {
  let entryFile: string | undefined;
  let inputDir: string | undefined;
  let outputDir: string | undefined;
  let timeoutMs: number | undefined;
  let useCache = true;
  let json = false;

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

    if (arg === "--json") {
      json = true;
      continue;
    }

    const inputDirOption = parseOptionValue(args, index, "--input-dir", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--input-dir",
        "--output-dir",
        "--timeout",
        "--json",
        "--no-cache",
        "--",
      ],
    });
    if (inputDirOption) {
      inputDir = inputDirOption.value;
      index = inputDirOption.nextIndex;
      continue;
    }

    const outputDirOption = parseOptionValue(args, index, "--output-dir", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--input-dir",
        "--output-dir",
        "--timeout",
        "--json",
        "--no-cache",
        "--",
      ],
    });
    if (outputDirOption) {
      outputDir = outputDirOption.value;
      index = outputDirOption.nextIndex;
      continue;
    }

    const timeoutOption = parseOptionValue(args, index, "--timeout", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--input-dir",
        "--output-dir",
        "--timeout",
        "--json",
        "--no-cache",
        "--",
      ],
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
    ...(json ? { json: true } : {}),
  };
}

function parseStressArgs(args: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  let iterations: number | undefined;
  let timeoutMs: number | undefined;
  let useCache = true;
  let json = false;

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

    if (arg === "--json") {
      json = true;
      continue;
    }

    const iterationsOption = parseOptionValue(args, index, "--iterations", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--iterations",
        "--timeout",
        "--json",
        "--no-cache",
        "--",
      ],
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
      reservedOptions: [
        "--iterations",
        "--timeout",
        "--json",
        "--no-cache",
        "--",
      ],
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
    ...(json ? { json: true } : {}),
  };
}

function parsePresetValue(value: string): InitPreset {
  if (value === "run" || value === "test" || value === "stress") {
    return value;
  }

  throw new Error(`Invalid init preset: "${value}".`);
}

function parseInitLanguage(value: string): InitLanguage {
  if (INIT_LANGUAGES.includes(value as InitLanguage)) {
    return value as InitLanguage;
  }

  throw new Error(`Unsupported init language: "${value}".`);
}

function parseInitArgs(args: string[]): ParsedCliArgs {
  let language: InitLanguage | undefined;
  let preset: InitPreset | undefined;
  let force = false;
  let yes = false;
  let json = false;
  let contest = false;
  let vscode = false;
  let gitignore = false;
  let inputDir: string | undefined;
  let outputDir: string | undefined;
  let entryFile: string | undefined;
  let solutionFile: string | undefined;
  let bruteFile: string | undefined;
  let generatorFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      const remaining = args.slice(index + 1);

      if (remaining.length > 1) {
        throw new Error(`Unexpected argument: ${remaining[1]}`);
      }

      if (remaining.length === 1) {
        if (language) {
          throw new Error(`Unexpected argument: ${remaining[0]}`);
        }

        language = parseInitLanguage(remaining[0]!);
      }

      break;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--yes") {
      yes = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--contest") {
      contest = true;
      continue;
    }

    if (arg === "--vscode") {
      vscode = true;
      continue;
    }

    if (arg === "--gitignore") {
      gitignore = true;
      continue;
    }

    if (arg === "--run") {
      preset = "run";
      continue;
    }

    if (arg === "--test") {
      preset = "test";
      continue;
    }

    if (arg === "--stress") {
      preset = "stress";
      continue;
    }

    const presetOption = parseOptionValue(args, index, "--preset");
    if (presetOption) {
      preset = parsePresetValue(presetOption.value);
      index = presetOption.nextIndex;
      continue;
    }

    const entryOption = parseOptionValue(args, index, "--entry", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (entryOption) {
      entryFile = entryOption.value;
      index = entryOption.nextIndex;
      continue;
    }

    const inputDirOption = parseOptionValue(args, index, "--input-dir", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (inputDirOption) {
      inputDir = inputDirOption.value;
      index = inputDirOption.nextIndex;
      continue;
    }

    const outputDirOption = parseOptionValue(args, index, "--output-dir", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (outputDirOption) {
      outputDir = outputDirOption.value;
      index = outputDirOption.nextIndex;
      continue;
    }

    const solutionOption = parseOptionValue(args, index, "--solution", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (solutionOption) {
      solutionFile = solutionOption.value;
      index = solutionOption.nextIndex;
      continue;
    }

    const bruteOption = parseOptionValue(args, index, "--brute", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (bruteOption) {
      bruteFile = bruteOption.value;
      index = bruteOption.nextIndex;
      continue;
    }

    const generatorOption = parseOptionValue(args, index, "--generator", {
      allowDashPrefixed: true,
      reservedOptions: [
        "--entry",
        "--input-dir",
        "--output-dir",
        "--solution",
        "--brute",
        "--generator",
        "--preset",
        "--run",
        "--test",
        "--stress",
        "--contest",
        "--vscode",
        "--gitignore",
        "--json",
        "--yes",
        "--force",
        "--",
      ],
    });
    if (generatorOption) {
      generatorFile = generatorOption.value;
      index = generatorOption.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!language) {
      language = parseInitLanguage(arg);
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  const resolvedPreset = preset;

  if (resolvedPreset === "stress" && entryFile) {
    throw new Error("--entry cannot be used with stress init.");
  }

  if (resolvedPreset === "stress" && (inputDir || outputDir)) {
    throw new Error(
      "--input-dir and --output-dir cannot be used with stress init.",
    );
  }

  if (resolvedPreset === "run" && (inputDir || outputDir)) {
    throw new Error("--input-dir and --output-dir require --preset=test.");
  }

  if (
    resolvedPreset !== "stress" &&
    (solutionFile || bruteFile || generatorFile)
  ) {
    throw new Error(
      "--solution, --brute, and --generator require --preset=stress.",
    );
  }

  if (
    resolvedPreset === "stress" &&
    [solutionFile, bruteFile, generatorFile].some(
      (value) => value === undefined,
    ) &&
    [solutionFile, bruteFile, generatorFile].some(
      (value) => value !== undefined,
    )
  ) {
    throw new Error(
      "Stress init requires --solution, --brute, and --generator together when any of them is provided.",
    );
  }

  return {
    help: false,
    command: "init",
    language,
    preset: resolvedPreset,
    force,
    yes,
    contest,
    vscode,
    gitignore,
    ...(json ? { json: true } : {}),
    inputDir,
    outputDir,
    entryFile,
    solutionFile,
    bruteFile,
    generatorFile,
  };
}

export function getHelpText() {
  return `
Usage:
  exvex <entry> [--input=FILE] [--timeout=MS] [--no-cache]
  exvex test [entry] [--input-dir=DIR] [--output-dir=DIR] [--timeout=MS] [--no-cache]
  exvex stress <solution> <brute> <generator> [--iterations=N] [--timeout=MS] [--no-cache]
  exvex init [language] [--preset=run|test|stress] [--contest] [--vscode] [--gitignore] [--yes] [--force]
  exvex --version
  exvex --help

Commands:
  <entry>          Run a supported source file directly
  test             Run sample tests from input/output paths
  stress           Compare a solution against a brute-force implementation
  init             Scaffold a ready-to-use workspace

Options:
  --input=FILE     Feed input from a file in run mode (also: --input FILE)
  --input-dir=DIR  Input path for judge mode (also: --input-dir DIR)
  --output-dir=DIR Output path for judge mode (also: --output-dir DIR)
  --iterations=N   Number of stress iterations (default: 100; also: --iterations N)
  --preset=NAME    Init preset: run, test, or stress
  --json           Print machine-readable JSON summaries for run, test, or stress mode
  --timeout=MS     Override execution timeout in milliseconds; use 0 to disable timeout
  --entry=FILE     Entry filename for init run/test presets
  --input-dir=DIR  Input path for judge mode and init test preset
  --output-dir=DIR Output path for judge mode and init test preset
  --solution=FILE  Solution filename for init stress preset
  --brute=FILE     Brute filename for init stress preset
  --generator=FILE Generator filename for init stress preset
  --contest        Init a/, b/, c/ problem folders instead of one workspace
  --vscode         Generate .vscode/tasks.json for scaffolded workflow
  --gitignore      Append .exvex/ to .gitignore during init
  --yes            Accept init defaults without prompting
  --               Stop option parsing; treat following args as positional values
  --no-cache       Disable compile cache for this invocation (.exvex/cache by default)
  --force          Overwrite init scaffold files if they already exist
  --version, -v    Print CLI version
  --help, -h       Show this help

Supported extensions:
  .c, .cpp, .py, .java, .js, .go, .rs, .kt, .php, .rb

Configuration:
  exvex reads exvex.config.json from current working directory when present.
  Default judge paths: input.txt and output.txt. Also supports input/ and output/ directories.
`.trim();
}

function emitJson(logger: CliLogger, payload: unknown) {
  logger.log(JSON.stringify(payload, null, 2));
}

function getJsonErrorCode(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    message.includes("Unknown option:") ||
    message.includes("Unexpected argument:") ||
    message.includes("must not be empty") ||
    message.includes("must be an integer") ||
    message.includes("must be a safe integer") ||
    message.includes("must be at least") ||
    message.includes("requires exactly three files") ||
    message.includes("An entry file is required.") ||
    message.includes("Unsupported init language:") ||
    message.includes("Invalid init preset:") ||
    message.includes("must be relative to current directory.") ||
    message.includes("must stay inside current directory.") ||
    message.includes('must end with "') ||
    message.includes("must use a valid Java class name before") ||
    message.includes("must both be .txt files or both be directories.") ||
    normalizedMessage.includes("stress init") ||
    normalizedMessage.includes("require --preset=stress") ||
    normalizedMessage.includes("require --preset=test") ||
    normalizedMessage.includes("cannot be used with stress init")
  ) {
    return "ARG_PARSE_ERROR";
  }

  if (message.includes("Required command not found")) {
    return "COMMAND_NOT_FOUND";
  }

  if (
    message.includes(CONFIG_FILENAME) ||
    message.startsWith("Invalid config:")
  ) {
    return "CONFIG_ERROR";
  }

  return "CLI_ERROR";
}

function wantsJsonOutput(args: string[]) {
  const endOfOptionsIndex = args.indexOf("--");
  const argsForJsonCheck =
    endOfOptionsIndex >= 0 ? args.slice(0, endOfOptionsIndex) : args;
  return hasStandaloneTopLevelFlag(argsForJsonCheck, ["--json"]);
}

function isVersionArgs(parsed: ParsedCliArgs): parsed is ParsedCliVersionArgs {
  return "version" in parsed && parsed.version === true;
}

function isCommandArgs(parsed: ParsedCliArgs): parsed is ParsedCliCommandArgs {
  return "command" in parsed;
}

const SPACE_SEPARATED_VALUE_OPTIONS = new Set([
  "--input",
  "--timeout",
  "--input-dir",
  "--output-dir",
  "--iterations",
  "--preset",
  "--entry",
  "--solution",
  "--brute",
  "--generator",
]);

function hasStandaloneTopLevelFlag(args: string[], flags: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (!flags.includes(arg)) {
      continue;
    }

    const previousArg = args[index - 1];
    if (previousArg && SPACE_SEPARATED_VALUE_OPTIONS.has(previousArg)) {
      continue;
    }

    return true;
  }

  return false;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  if (args.length === 0) {
    return { help: true };
  }

  const endOfOptionsIndex = args.indexOf("--");
  const argsForFlagCheck =
    endOfOptionsIndex >= 0 ? args.slice(0, endOfOptionsIndex) : args;
  if (hasStandaloneTopLevelFlag(argsForFlagCheck, ["--help", "-h"])) {
    return { help: true };
  }
  if (hasStandaloneTopLevelFlag(argsForFlagCheck, ["--version", "-v"])) {
    return { help: false, version: true };
  }

  const [command, ...rest] = args;

  if (command === "test") {
    return parseTestArgs(rest);
  }

  if (command === "stress") {
    return parseStressArgs(rest);
  }

  if (command === "init") {
    return parseInitArgs(rest);
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
      `Process failed: ${describeExitCode(result.exitCode)}.`,
      "red",
      isTty,
    ),
  );

  const stderr = result.stderr.trim();

  if (stderr) {
    logger.error(stderr);
  }
}

function logInitSummary(summary: InitSummary, logger: CliLogger) {
  const heading =
    summary.overwrittenPaths.length > 0
      ? "Created/updated files:"
      : "Created files:";
  logger.log(heading);

  for (const path of summary.createdPaths) {
    logger.log(`  ${path}`);
  }

  for (const path of summary.overwrittenPaths) {
    logger.log(`  ${path}`);
  }

  logger.log("");
  logger.log("Next:");
  logger.log(`  ${summary.nextCommand}`);
}

export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultCliDependencies,
) {
  const { logger } = dependencies;
  let parsedArgs: string[] | undefined;

  try {
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

    if (
      (parsedArgs ?? args).length === 1 &&
      (parsedArgs ?? args)[0] === "init" &&
      dependencies.isTty
    ) {
      const initArgs = await (dependencies.promptForInitArgs
        ? dependencies.promptForInitArgs()
        : promptForInitCommandArgs());

      if (initArgs === null) {
        return 0;
      }

      parsedArgs = initArgs;
    }

    const parsed = parseCliArgs(parsedArgs ?? args);

    if (parsed.help) {
      logger.log(getHelpText());
      return 0;
    }

    if (isVersionArgs(parsed)) {
      logger.log(pkg.version);
      return 0;
    }

    if (!isCommandArgs(parsed)) {
      throw new Error("Internal CLI parse error: expected command arguments.");
    }

    if (parsed.command === "run") {
      const jsonMode = parsed.json === true;
      const runRequest: RunRequest = {
        entryFile: parsed.entryFile,
        cwd: dependencies.cwd(),
        inputFile: parsed.inputFile,
        timeoutMs: parsed.timeoutMs,
        useCache: parsed.useCache,
        stdin: parsed.inputFile ? null : dependencies.stdin,
        stdout: jsonMode ? null : dependencies.stdout,
        stderr: jsonMode ? null : dependencies.stderr,
      };
      const result = await dependencies.runFile(runRequest);

      if (jsonMode) {
        emitJson(logger, result);
      }

      if (result.timedOut || result.exitCode !== 0) {
        if (!jsonMode) {
          logRunFailure(result, logger, dependencies.isTty);
        }
        return 1;
      }

      return 0;
    }

    if (parsed.command === "test") {
      const jsonMode = parsed.json === true;
      const summary = await dependencies.runJudge({
        entryFile: parsed.entryFile,
        cwd: dependencies.cwd(),
        inputDir: parsed.inputDir,
        outputDir: parsed.outputDir,
        timeoutMs: parsed.timeoutMs,
        useCache: parsed.useCache,
      });

      if (jsonMode) {
        emitJson(logger, summary);
      } else {
        logJudgeSummary(summary, logger, dependencies.isTty);
      }
      return summary.failed === 0 ? 0 : 1;
    }

    if (parsed.command === "init") {
      const summary = await dependencies.initProject({
        cwd: dependencies.cwd(),
        language: parsed.language ?? "cpp",
        preset: parsed.preset ?? "test",
        force: parsed.force,
        contest: parsed.contest,
        vscode: parsed.vscode,
        gitignore: parsed.gitignore,
        inputDir: parsed.inputDir,
        outputDir: parsed.outputDir,
        entryFile: parsed.entryFile,
        solutionFile: parsed.solutionFile,
        bruteFile: parsed.bruteFile,
        generatorFile: parsed.generatorFile,
      });

      if (parsed.json) {
        emitJson(logger, summary);
      } else {
        logInitSummary(summary, logger);
      }
      return 0;
    }

    const jsonMode = parsed.json === true;
    const summary = await dependencies.runStress({
      solutionFile: parsed.solutionFile,
      bruteFile: parsed.bruteFile,
      generatorFile: parsed.generatorFile,
      cwd: dependencies.cwd(),
      iterations: parsed.iterations,
      timeoutMs: parsed.timeoutMs,
      useCache: parsed.useCache,
    });

    if (jsonMode) {
      emitJson(logger, summary);
    } else {
      logStressSummary(summary, logger, dependencies.isTty);
    }
    return summary.success ? 0 : 1;
  } catch (error) {
    if (wantsJsonOutput(parsedArgs ?? args)) {
      emitJson(logger, {
        success: false,
        error: {
          code: getJsonErrorCode(getErrorMessage(error)),
          message: getErrorMessage(error),
        },
      });
    } else {
      logger.error(`Error: ${getErrorMessage(error)}`);
    }
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
    const modulePath = moduleUrl.startsWith("file:")
      ? fileURLToPath(moduleUrl)
      : moduleUrl;

    return normalizePathToHref(entryPath) === normalizePathToHref(modulePath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  void main();
}
