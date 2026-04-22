import type { Readable, Writable } from "stream";

export type SupportedLanguage =
  | "c"
  | "cpp"
  | "python"
  | "java"
  | "javascript"
  | "go"
  | "rust"
  | "kotlin"
  | "php"
  | "ruby";

export interface ExvexConfig {
  c?: string;
  cpp?: string;
  python?: string;
  javaCompiler?: string;
  javaRuntime?: string;
  javascript?: string;
  go?: string;
  rust?: string;
  kotlinCompiler?: string;
  kotlinRuntime?: string;
  php?: string;
  ruby?: string;
  timeout?: number;
  cacheDir?: string;
  inputDir?: string;
  outputDir?: string;
  retainTempArtifactsOnSuccess?: boolean;
  retainTempArtifactsOnFailure?: boolean;
  stressArtifactMode?: "overwrite" | "timestamp";
}

export interface ResolvedExvexConfig {
  c: string;
  cpp: string;
  python: string;
  javaCompiler: string;
  javaRuntime: string;
  javascript: string;
  go: string;
  rust: string;
  kotlinCompiler: string;
  kotlinRuntime: string;
  php: string;
  ruby: string;
  timeout: number;
  cacheDir: string;
  inputDir: string;
  outputDir: string;
  retainTempArtifactsOnSuccess: boolean;
  retainTempArtifactsOnFailure: boolean;
  stressArtifactMode: "overwrite" | "timestamp";
}

export interface RunRequest {
  entryFile: string;
  cwd?: string;
  inputFile?: string;
  inputText?: string;
  timeoutMs?: number;
  useCache?: boolean;
  stdin?: Readable | null;
  stdout?: Writable | null;
  stderr?: Writable | null;
}

export interface RunResult {
  entryFile: string;
  language: SupportedLanguage;
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutMs: number;
  timedOut: boolean;
  artifactPath?: string;
}

export interface JudgeCase {
  name: string;
  inputPath: string;
  outputPath: string;
}

export interface JudgeCaseResult extends JudgeCase {
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
  diff?: string;
  runResult: RunResult;
}

export interface JudgeSummary {
  entryFile: string;
  total: number;
  passed: number;
  failed: number;
  cases: JudgeCaseResult[];
}

export interface StressRequest {
  solutionFile: string;
  bruteFile: string;
  generatorFile: string;
  cwd?: string;
  iterations?: number;
  timeoutMs?: number;
  useCache?: boolean;
}

export interface StressSummary {
  totalIterations: number;
  completedIterations: number;
  success: boolean;
  failureReason?:
    | "mismatch"
    | "generator-error"
    | "solution-error"
    | "brute-error"
    | "timeout";
  failingIteration?: number;
  message?: string;
  artifactDir?: string;
  artifactMetadataPath?: string;
  generatorResult?: RunResult;
  solutionResult?: RunResult;
  bruteResult?: RunResult;
}
