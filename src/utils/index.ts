import { extname } from "path";
import type {
  ExvexConfig,
  ResolvedExvexConfig,
  SupportedLanguage,
} from "../interface";

export const CONFIG_FILENAME = "exvex.config.json";
export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_STRESS_ITERATIONS = 100;

export const DEFAULT_CONFIG: ResolvedExvexConfig = {
  c: "gcc -O2 -std=c11",
  cpp: "g++ -O2 -std=c++17",
  python: "python3",
  javaCompiler: "javac",
  javaRuntime: "java",
  javascript: "node",
  go: "go build",
  rust: "rustc -O",
  kotlinCompiler: "kotlinc",
  kotlinRuntime: "java",
  php: "php",
  ruby: "ruby",
  timeout: DEFAULT_TIMEOUT_MS,
  cacheDir: ".exvex/cache",
  inputDir: "input",
  outputDir: "output",
};

export const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage> = {
  ".c": "c",
  ".cpp": "cpp",
  ".py": "python",
  ".java": "java",
  ".js": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".kt": "kotlin",
  ".php": "php",
  ".rb": "ruby",
};

export const SUPPORTED_SOURCE_EXTENSIONS = Object.keys(LANGUAGE_EXTENSIONS);

export const MAIN_FILE_NAMES = [
  "main",
  "Main",
  "main.cpp",
  "main.c",
  "main.py",
  "main.java",
  "Main.java",
  "main.js",
  "main.go",
  "main.rs",
  "main.kt",
  "Main.kt",
  "main.php",
  "main.rb",
];

function assertNonEmptyString(value: unknown, key: keyof ResolvedExvexConfig) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid config: "${key}" must be a non-empty string.`);
  }
}

function assertNonNegativeInteger(
  value: unknown,
  key: keyof ResolvedExvexConfig,
) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid config: "${key}" must be a non-negative integer.`);
  }
}

export function resolveConfig(config: ExvexConfig = {}): ResolvedExvexConfig {
  assertNonEmptyString(config.c, "c");
  assertNonEmptyString(config.cpp, "cpp");
  assertNonEmptyString(config.python, "python");
  assertNonEmptyString(config.javaCompiler, "javaCompiler");
  assertNonEmptyString(config.javaRuntime, "javaRuntime");
  assertNonEmptyString(config.javascript, "javascript");
  assertNonEmptyString(config.go, "go");
  assertNonEmptyString(config.rust, "rust");
  assertNonEmptyString(config.kotlinCompiler, "kotlinCompiler");
  assertNonEmptyString(config.kotlinRuntime, "kotlinRuntime");
  assertNonEmptyString(config.php, "php");
  assertNonEmptyString(config.ruby, "ruby");
  assertNonEmptyString(config.cacheDir, "cacheDir");
  assertNonEmptyString(config.inputDir, "inputDir");
  assertNonEmptyString(config.outputDir, "outputDir");
  assertNonNegativeInteger(config.timeout, "timeout");

  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

export function detectLanguageFromPath(
  filePath: string,
): SupportedLanguage | null {
  return LANGUAGE_EXTENSIONS[extname(filePath).toLowerCase()] ?? null;
}

export function splitCommand(command: string) {
  const trimmed = command.trim();

  if (!trimmed) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    const nextCharacter = trimmed[index + 1];

    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (quote === null) {
      if (character === "\\") {
        if (
          nextCharacter !== undefined &&
          (/\s/.test(nextCharacter) ||
            nextCharacter === '"' ||
            nextCharacter === "'" ||
            nextCharacter === "\\")
        ) {
          escaping = true;
          continue;
        }

        current += character;
        continue;
      }

      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }

      if (/\s/.test(character)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += character;
      continue;
    }

    if (quote === "'" && character === "'") {
      quote = null;
      continue;
    }

    if (quote === '"' && character === '"') {
      quote = null;
      continue;
    }

    if (character === "\\" && quote === '"') {
      if (
        nextCharacter !== undefined &&
        (nextCharacter === '"' ||
          nextCharacter === "\\" ||
          nextCharacter === "$" ||
          nextCharacter === "`")
      ) {
        escaping = true;
        continue;
      }

      current += character;
      continue;
    }

    current += character;
  }

  if (quote !== null) {
    throw new Error(`Invalid command: unmatched ${quote} quote.`);
  }

  if (escaping) {
    current += "\\";
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function normalizeOutput(output: string) {
  return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

export function sortCaseNames(names: string[]) {
  return [...names].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "variant",
    }),
  );
}

export function formatDurationMs(durationMs: number) {
  if (durationMs < 100) {
    return `${durationMs.toFixed(1)}ms`;
  }

  return `${Math.round(durationMs)}ms`;
}
