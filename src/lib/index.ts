import { spawn } from "child_process";
import { createHash } from "crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "path";
import type {
  ExvexConfig,
  JudgeCase,
  JudgeCaseResult,
  JudgeSummary,
  ResolvedExvexConfig,
  RunRequest,
  RunResult,
  StressRequest,
  StressSummary,
  SupportedLanguage,
} from "../interface";
import {
  CONFIG_FILENAME,
  DEFAULT_STRESS_ITERATIONS,
  detectLanguageFromPath,
  formatDurationMs,
  MAIN_FILE_NAMES,
  normalizeOutput,
  resolveConfig,
  sortCaseNames,
  splitCommand,
  SUPPORTED_SOURCE_EXTENSIONS,
} from "../utils";

interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  envPathPrepend?: string;
  inputText?: string;
  inputStream?: NodeJS.ReadableStream | null;
  stdoutStream?: NodeJS.WritableStream | null;
  stderrStream?: NodeJS.WritableStream | null;
}

interface ProcessRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutMs: number;
  timedOut: boolean;
}

interface PreparedExecution {
  command: string[];
  artifactPath?: string;
  cleanupPath?: string;
  envPathPrepend?: string;
}

type NativeLanguage = "c" | "cpp" | "go" | "rust";
const MIN_COMPILE_TIMEOUT_MS = 30000;
const COMPILE_CACHE_VERSION = "compile-v2";

interface StressArtifactMetadata {
  failureReason:
    | "mismatch"
    | "generator-error"
    | "solution-error"
    | "brute-error"
    | "timeout";
  failingIteration: number;
  message: string;
}

function createStressArtifactDirectoryName(iteration: number) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-iter-${String(iteration).padStart(4, "0")}`;
}

interface DetectedSourceFile {
  name: string;
  path: string;
  language: SupportedLanguage;
}

function getJavaDeclaredMainClassName(content: string) {
  const typeMatch = stripJavaAnnotationsForSignatureMatching(content).match(
    /^\s*(?:public\s+)?(?:(?:abstract|final|sealed|non-sealed|static)\s+)*(?:class|record|enum|interface)\s+([A-Za-z_]\w*)/m,
  );

  return typeMatch?.[1] ?? null;
}

function stripJavaAnnotationsForSignatureMatching(content: string) {
  return content.replace(
    /^\s*(?:@[A-Za-z_][\w.]*(?:\([^)\r\n]*\))?\s*)+/gm,
    "",
  );
}

function terminateProcessTree(pid: number) {
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Ignore failures when the process is already gone.
        }
      });
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore failures when the process is already gone.
      }
    }

    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore failures when the process is already gone.
    }
  }
}

function resolveFrom(baseDir: string, filePath: string) {
  return isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function ensureFileExists(path: string, label: string) {
  if (!(await pathExists(path))) {
    throw new Error(`${label} not found: ${path}`);
  }

  const pathStats = await stat(path);

  if (!pathStats.isFile()) {
    throw new Error(`${label} must be a file: ${path}`);
  }
}

async function ensureDirectoryExists(path: string, label: string) {
  if (!(await pathExists(path))) {
    throw new Error(`${label} not found: ${path}`);
  }

  const pathStats = await stat(path);

  if (!pathStats.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

function ensureNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function ensurePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function detectLanguageFromContent(content: string): SupportedLanguage | null {
  const trimmed = content.trimStart();
  const shebang = content.split("\n", 1)[0] ?? "";
  const javaLikeContent = stripJavaAnnotationsForSignatureMatching(content);

  if (shebang.startsWith("#!")) {
    if (/\bnode(\s|$)/.test(shebang)) {
      return "javascript";
    }

    if (/\bpython(?:3)?(\s|$)/.test(shebang)) {
      return "python";
    }

    if (/\bruby(\s|$)/.test(shebang)) {
      return "ruby";
    }

    if (/\bphp(\s|$)/.test(shebang)) {
      return "php";
    }
  }

  if (/^\s*<\?php\b/m.test(content)) {
    return "php";
  }

  if (
    /^\s*package\s+main\b/m.test(content) &&
    /^\s*func\s+main\s*\(/m.test(content)
  ) {
    return "go";
  }

  if (/^\s*fn\s+main\s*\(/m.test(content)) {
    return "rust";
  }

  if (/^\s*fun\s+main\s*\(/m.test(content)) {
    return "kotlin";
  }

  if (
    /^\s*(?:public\s+)?(?:(?:abstract|final|sealed|non-sealed|static)\s+)*(?:class|record|enum|interface)\s+\w+/m.test(
      javaLikeContent,
    ) &&
    /^\s*(?:(?:public|protected|private|static|final|synchronized|strictfp)\s+)*void\s+main\s*\(\s*String(?:\s*\[\s*\]|\s*\.\.\.)\s+\w+\s*\)/m.test(
      javaLikeContent,
    )
  ) {
    return "java";
  }

  if (
    /#include\s*<(?:iostream|bits\/stdc\+\+\.h|vector|string|map|set|unordered_map|unordered_set|queue|stack|deque|algorithm|numeric|tuple|optional)>/.test(
      content,
    ) ||
    /#include\s*<(?:cstdio|cstdlib|cstring|cmath)>/.test(content) ||
    /\bstd::/.test(content) ||
    /^\s*using\s+namespace\s+std\s*;/m.test(content)
  ) {
    return "cpp";
  }

  if (/#include\s*<stdio\.h>/.test(content)) {
    return "c";
  }

  if (
    /^\s*#include\s*<(?:stdlib|string|stdint|stdbool|stddef|errno|signal|math|ctype|time|limits|assert)\.h>/m.test(
      content,
    ) &&
    /\bint\s+main\s*\(/.test(content)
  ) {
    return "c";
  }

  if (
    /__name__\s*==\s*["']__main__["']/.test(content) ||
    /^\s*from\s+[A-Za-z_][\w.]*\s+import\s+/m.test(content) ||
    /^\s*def\s+\w+\s*\([^)]*\)\s*:/m.test(content) ||
    /^\s*class\s+\w+(?:\([^)]*\))?\s*:/m.test(content)
  ) {
    return "python";
  }

  if (
    /^\s*import\s+(?:[\w*\s{},]*\s+from\s+)?["'][^"']+["'];?/m.test(content) ||
    /^\s*require\s*\(\s*["'][^"']+["']\s*\)\s*;?/m.test(content) ||
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|\{)/m.test(
      content,
    ) ||
    /^\s*(const|let|var)\s+\w+/m.test(content) ||
    /\bconsole\.(log|error|warn)\s*\(/.test(content) ||
    /\bmodule\.exports\b/.test(content) ||
    /\bprocess\.(argv|env|exit|stdout|stdin|stderr)\b/.test(content)
  ) {
    return "javascript";
  }

  if (
    /^\s*(puts|require|require_relative|load)\b/m.test(content) &&
    !trimmed.startsWith("<?") &&
    !/^\s*require\s*\(/.test(content)
  ) {
    return "ruby";
  }

  return null;
}

export async function detectLanguageForFile(filePath: string) {
  const extensionLanguage = detectLanguageFromPath(filePath);

  if (extensionLanguage) {
    return extensionLanguage;
  }

  try {
    const content = await readFile(filePath, "utf8");
    return detectLanguageFromContent(content.slice(0, 8192));
  } catch {
    return null;
  }
}

async function getDetectedSourceFiles(cwd: string) {
  const entries = await readdir(cwd, { withFileTypes: true });
  const detected: DetectedSourceFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const entryPath = resolve(cwd, entry.name);
    const language = await detectLanguageForFile(entryPath);

    if (!language) {
      continue;
    }

    detected.push({
      name: entry.name,
      path: entryPath,
      language,
    });
  }

  return detected;
}

function getProcessFailureMessage(
  action: string,
  command: string[],
  result: ProcessRunResult,
) {
  const header = result.timedOut
    ? `${action} timed out after ${result.timeoutMs}ms.`
    : `${action} failed with exit code ${result.exitCode ?? "unknown"}.`;
  const details = [header, `Command: ${formatCommandForDisplay(command)}`];

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();

  if (stderr) {
    details.push(stderr);
  } else if (stdout) {
    details.push(stdout);
  }

  return details.join("\n");
}

function formatCommandForDisplay(command: string[]) {
  return command
    .map((part) =>
      /[\s"]/u.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part,
    )
    .join(" ");
}

function getCommandNotFoundMessage(command: string) {
  const isExplicitPath =
    isAbsolute(command) ||
    /^[A-Za-z]:[\\/]/.test(command) ||
    /[\\/]/.test(command);

  if (isExplicitPath) {
    return `Required command not found: "${command}". Verify the path exists or use a PATH command such as "g++" in ${CONFIG_FILENAME}.`;
  }

  return `Required command not found on PATH: "${command}". Install the toolchain, add it to PATH, or override it in ${CONFIG_FILENAME}.`;
}

function getCommandStartFailureMessage(
  command: string,
  error: NodeJS.ErrnoException,
) {
  if (error.code === "ENOENT") {
    return getCommandNotFoundMessage(command);
  }

  if (error.code === "EPERM" || error.code === "UNKNOWN") {
    return `Failed to start required command "${command}" (${error.code}). Verify the toolchain is installed, compatible with this system, and available on PATH or override it in ${CONFIG_FILENAME}.`;
  }

  return `Failed to start "${command}": ${error.message}`;
}

function getRuntimeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DEBUG: "true",
    CPH: "true",
  };
}

function getCompileTimeoutMs(timeoutMs: number) {
  return timeoutMs === 0 ? 0 : Math.max(timeoutMs, MIN_COMPILE_TIMEOUT_MS);
}

function isWindowsCompilerFallbackCandidate(
  language: NativeLanguage,
  command: string,
) {
  if (
    process.platform !== "win32" ||
    (language !== "c" && language !== "cpp")
  ) {
    return false;
  }

  const lowerCommand = command.toLowerCase();
  return (
    (language === "cpp" &&
      (lowerCommand === "g++" || lowerCommand === "g++.exe")) ||
    (language === "c" && (lowerCommand === "gcc" || lowerCommand === "gcc.exe"))
  );
}

function shouldTryWindowsCompilerFallback(
  language: NativeLanguage,
  command: string,
  error: unknown,
) {
  if (!isWindowsCompilerFallbackCandidate(language, command)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes(`Failed to start required command "${command}"`) &&
    (error.message.includes("(UNKNOWN)") || error.message.includes("(EPERM)"))
  );
}

async function getWindowsCompilerFallback(
  language: "c" | "cpp",
): Promise<{ command: string; envPathPrepend: string } | null> {
  const compilerName = language === "cpp" ? "g++.exe" : "gcc.exe";
  const candidates = [
    `C:/msys64/ucrt64/bin/${compilerName}`,
    `C:/msys64/mingw64/bin/${compilerName}`,
    `C:/msys64/clang64/bin/${compilerName}`,
  ];

  for (const command of candidates) {
    if (!(await isFile(command))) {
      continue;
    }

    const envPathPrepend = dirname(command);
    try {
      await runProcess({
        command,
        args: ["--version"],
        cwd: process.cwd(),
        timeoutMs: 2000,
        envPathPrepend,
      });
      return { command, envPathPrepend };
    } catch {
      // Try the next known MSYS2 environment.
    }
  }

  return null;
}

async function resolveNativeCompilerExecutable({
  language,
  command,
  cwd,
  timeoutMs,
}: {
  language: NativeLanguage;
  command: string;
  cwd: string;
  timeoutMs: number;
}): Promise<{ command: string; envPathPrepend?: string }> {
  if (!isWindowsCompilerFallbackCandidate(language, command)) {
    return { command };
  }

  try {
    await runProcess({
      command,
      args: ["--version"],
      cwd,
      timeoutMs: timeoutMs === 0 ? 0 : 2000,
    });
    return { command };
  } catch (error) {
    if (!shouldTryWindowsCompilerFallback(language, command, error)) {
      throw error;
    }

    const fallback =
      language === "c" || language === "cpp"
        ? await getWindowsCompilerFallback(language)
        : null;
    if (!fallback) {
      throw error;
    }

    return fallback;
  }
}

async function runProcess({
  command,
  args,
  cwd,
  timeoutMs,
  env,
  envPathPrepend,
  inputText,
  inputStream,
  stdoutStream,
  stderrStream,
}: ProcessRunOptions): Promise<ProcessRunResult> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const startedAt = performance.now();
    const useProcessGroup = process.platform !== "win32";
    const processEnv = env ?? process.env;
    const spawnEnv = envPathPrepend
      ? {
          ...processEnv,
          PATH: `${envPathPrepend}${process.platform === "win32" ? ";" : ":"}${processEnv.PATH ?? ""}`,
        }
      : processEnv;
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(command, args, {
        cwd,
        env: spawnEnv,
        windowsHide: true,
        detached: useProcessGroup,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      rejectPromise(
        new Error(
          getCommandStartFailureMessage(
            command,
            error as NodeJS.ErrnoException,
          ),
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const terminateChild = () => {
      if (child.exitCode !== null) {
        return;
      }

      if (child.pid) {
        terminateProcessTree(child.pid);
        return;
      }

      if (!child.killed) {
        child.kill("SIGKILL");
      }
    };

    // timeoutMs === 0 means no timeout (infinite wait).
    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            terminateChild();
          }, timeoutMs)
        : undefined;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (inputStream && child.stdin) {
        inputStream.unpipe(child.stdin);
      }

      callback();
    };

    child.once("error", (error) => {
      terminateChild();
      finish(() => {
        rejectPromise(
          new Error(
            getCommandStartFailureMessage(
              command,
              error as NodeJS.ErrnoException,
            ),
          ),
        );
      });
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      stdoutStream?.write(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      stderrStream?.write(chunk);
    });
    child.stdin?.on("error", () => {
      // Ignore EPIPE when a process exits before all input is written.
    });

    child.once("close", (exitCode) => {
      finish(() => {
        resolvePromise({
          exitCode,
          stdout,
          stderr,
          durationMs: performance.now() - startedAt,
          timeoutMs,
          timedOut,
        });
      });
    });

    if (inputText !== undefined) {
      child.stdin?.end(inputText);
      return;
    }

    if (inputStream) {
      if (child.stdin) {
        inputStream.pipe(child.stdin);
      }
      return;
    }

    child.stdin?.end();
  });
}

async function getSourceSignature(
  entryPath: string,
  language: SupportedLanguage,
) {
  const sourceFiles = await getSignatureSourceFiles(entryPath, language);
  const signatures = await Promise.all(
    sourceFiles.map(async (file) => {
      const fileContent = await readFile(file);
      const contentHash = createHash("sha1").update(fileContent).digest("hex");
      return `${file}:${contentHash}`;
    }),
  );

  return signatures.join("|");
}

async function getSignatureSourceFiles(
  entryPath: string,
  language: SupportedLanguage,
) {
  const listFilesRecursively = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const currentPath = join(directory, entry.name);

        if (entry.isDirectory()) {
          return await listFilesRecursively(currentPath);
        }

        if (entry.isFile()) {
          return [currentPath];
        }

        return [];
      }),
    );

    return files.flat();
  };

  if (language === "c" || language === "cpp") {
    const directory = dirname(entryPath);
    const headerExtensions =
      language === "c"
        ? [".h", ".inc"]
        : [".h", ".hh", ".hpp", ".hxx", ".inc", ".ipp", ".tpp"];
    const sourceFiles = (await listFilesRecursively(directory))
      .filter((filePath) => {
        const extension = extname(filePath).toLowerCase();
        return filePath === entryPath || headerExtensions.includes(extension);
      })
      .sort();

    return sourceFiles;
  }

  if (language === "rust") {
    const directory = dirname(entryPath);
    const sourceFiles = (await listFilesRecursively(directory))
      .filter((filePath) => filePath.endsWith(".rs"))
      .sort();

    return sourceFiles.length > 0 ? sourceFiles : [entryPath];
  }

  return await getCompilationSourceFiles(entryPath, language);
}

async function getCompilationSourceFiles(
  entryPath: string,
  language: SupportedLanguage,
) {
  const listFilesRecursively = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPathInDirectory = join(directory, entry.name);

        if (entry.isDirectory()) {
          return await listFilesRecursively(entryPathInDirectory);
        }

        if (entry.isFile()) {
          return [entryPathInDirectory];
        }

        return [];
      }),
    );

    return files.flat();
  };
  const multiFileExtension =
    language === "java"
      ? ".java"
      : language === "go"
        ? ".go"
        : language === "kotlin"
          ? ".kt"
          : null;

  if (!multiFileExtension) {
    return [entryPath];
  }

  const directory = dirname(entryPath);
  const scannedFiles = (
    language === "java" || language === "kotlin"
      ? await listFilesRecursively(directory)
      : (await readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => join(directory, entry.name))
  ).filter((filePath) => {
    if (!filePath.endsWith(multiFileExtension)) {
      return false;
    }

    if (language === "go" && filePath.endsWith("_test.go")) {
      return false;
    }

    return true;
  });

  // Always include the entry file itself. Content-based detection can identify
  // a file as Go/Java/Kotlin even when it lacks the standard extension, and the
  // extension-based scan above would silently omit it, causing either a
  // misleading "No sources found" error or compilation of the wrong file set.
  return [...new Set([...scannedFiles, entryPath])].sort();
}

export async function getCompilationSourceFilesForTests(
  entryPath: string,
  language: SupportedLanguage,
) {
  return await getCompilationSourceFiles(entryPath, language);
}

async function stageMultiFileSourcesWithExtension({
  entryPath,
  sourceFiles,
  artifactDir,
  requiredExtension,
  resolveExtensionlessTargetBaseName,
}: {
  entryPath: string;
  sourceFiles: string[];
  artifactDir: string;
  requiredExtension: ".java" | ".kt";
  resolveExtensionlessTargetBaseName?: (
    sourceFile: string,
    sourceContent: string,
  ) => string | null;
}) {
  const sourceRoot = dirname(entryPath);
  const stagedSourceDir = join(
    artifactDir,
    requiredExtension === ".java" ? "java-src" : "kotlin-src",
  );
  await rm(stagedSourceDir, { recursive: true, force: true });
  await mkdir(stagedSourceDir, { recursive: true });

  const stagedSourceFiles: string[] = [];

  for (const sourceFile of sourceFiles) {
    const relativeSourcePath = relative(sourceRoot, sourceFile);
    const extensionlessTargetBaseName =
      sourceFile.endsWith(requiredExtension) ||
      !resolveExtensionlessTargetBaseName
        ? null
        : resolveExtensionlessTargetBaseName(
            sourceFile,
            await readFile(sourceFile, "utf8"),
          );
    const targetRelativePath = sourceFile.endsWith(requiredExtension)
      ? relativeSourcePath
      : join(
          dirname(relativeSourcePath),
          `${extensionlessTargetBaseName ?? basename(relativeSourcePath)}${requiredExtension}`,
        );
    const stagedPath = join(stagedSourceDir, targetRelativePath);

    await mkdir(dirname(stagedPath), { recursive: true });
    await copyFile(sourceFile, stagedPath);
    stagedSourceFiles.push(stagedPath);
  }

  return {
    stagedSourceDir,
    stagedSourceFiles,
  };
}

function getBinaryName(entryPath: string) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return `${basename(entryPath, extname(entryPath))}${suffix}`;
}

async function getCacheBaseDir(cwd: string, config: ResolvedExvexConfig) {
  const cacheBaseDir = resolve(cwd, config.cacheDir);
  await mkdir(cacheBaseDir, { recursive: true });
  return cacheBaseDir;
}

async function cleanupTempArtifacts(
  artifactDir: string,
  useCache: boolean,
  retainArtifacts: boolean,
) {
  if (useCache || retainArtifacts) {
    return;
  }

  await rm(artifactDir, { recursive: true, force: true });
}

async function prepareNativeExecution({
  entryPath,
  language,
  config,
  cwd,
  timeoutMs,
  useCache,
}: {
  entryPath: string;
  language: "c" | "cpp" | "go" | "rust";
  config: ResolvedExvexConfig;
  cwd: string;
  timeoutMs: number;
  useCache: boolean;
}): Promise<PreparedExecution> {
  const compileCommand =
    language === "c"
      ? config.c
      : language === "cpp"
        ? config.cpp
        : language === "go"
          ? config.go
          : config.rust;
  const compileParts = splitCommand(compileCommand);

  if (compileParts.length === 0) {
    throw new Error(`Invalid compile command for ${language}.`);
  }
  const compileExecutable = await resolveNativeCompilerExecutable({
    language,
    command: compileParts[0],
    cwd,
    timeoutMs,
  });

  const sourceSignature = await getSourceSignature(entryPath, language);
  const sourceFiles = await getCompilationSourceFiles(entryPath, language);
  const compileTimeoutMs = getCompileTimeoutMs(timeoutMs);
  const effectiveCompileCommand = [
    compileExecutable.command,
    ...compileParts.slice(1),
  ].join(" ");
  const artifactDir = useCache
    ? join(
        await getCacheBaseDir(cwd, config),
        buildCacheKey({
          entryPath,
          sourceSignature,
          compileCommand: effectiveCompileCommand,
        }),
      )
    : await mkdtemp(join(tmpdir(), "exvex-native-"));
  const artifactPath = join(artifactDir, getBinaryName(entryPath));

  if (!useCache || !(await pathExists(artifactPath))) {
    await mkdir(artifactDir, { recursive: true });
    let compileTarget = entryPath;
    let compileCwd = cwd;
    let stagedGoSourceDir: string | undefined;

    if (language === "go") {
      const stagedSourceDir = await mkdtemp(join(tmpdir(), "exvex-go-src-"));
      stagedGoSourceDir = stagedSourceDir;

      let syntheticIndex = 0;
      for (const sourceFile of sourceFiles) {
        const stagedName = sourceFile.endsWith(".go")
          ? basename(sourceFile)
          : `exvex_${(syntheticIndex += 1)}.go`;
        await copyFile(sourceFile, join(stagedSourceDir, stagedName));
      }

      await writeFile(
        join(stagedSourceDir, "go.mod"),
        "module solution\n\ngo 1.21\n",
      );
      compileTarget = ".";
      compileCwd = stagedSourceDir;
    }

    const compileArgs =
      language === "go"
        ? [...compileParts.slice(1), "-o", artifactPath, compileTarget]
        : language === "c" || language === "cpp"
          ? [
              ...compileParts.slice(1),
              compileTarget,
              "-o",
              artifactPath,
              "-D",
              "DEBUG",
              "-D",
              "CPH",
            ]
          : [...compileParts.slice(1), compileTarget, "-o", artifactPath];
    let compileResult: ProcessRunResult;
    try {
      compileResult = await runProcess({
        command: compileExecutable.command,
        args: compileArgs,
        cwd: compileCwd,
        timeoutMs: compileTimeoutMs,
        envPathPrepend: compileExecutable.envPathPrepend,
      });
    } finally {
      if (stagedGoSourceDir) {
        await rm(stagedGoSourceDir, { recursive: true, force: true });
      }
    }

    if (compileResult.timedOut || compileResult.exitCode !== 0) {
      await cleanupTempArtifacts(
        artifactDir,
        useCache,
        config.retainTempArtifactsOnFailure,
      );
      throw new Error(
        getProcessFailureMessage(
          `Compilation (${language})`,
          [compileExecutable.command, ...compileArgs],
          compileResult,
        ),
      );
    }
  }

  return {
    command: [artifactPath],
    artifactPath,
    cleanupPath: useCache ? undefined : artifactDir,
    envPathPrepend: compileExecutable.envPathPrepend,
  };
}

async function prepareKotlinExecution({
  entryPath,
  config,
  cwd,
  timeoutMs,
  useCache,
}: {
  entryPath: string;
  config: ResolvedExvexConfig;
  cwd: string;
  timeoutMs: number;
  useCache: boolean;
}): Promise<PreparedExecution> {
  const compileParts = splitCommand(config.kotlinCompiler);
  const runtimeParts = splitCommand(config.kotlinRuntime);

  if (compileParts.length === 0) {
    throw new Error("Invalid compile command for kotlin.");
  }

  if (runtimeParts.length === 0) {
    throw new Error("Invalid runtime command for kotlin.");
  }

  const compileTimeoutMs = getCompileTimeoutMs(timeoutMs);
  const sourceSignature = await getSourceSignature(entryPath, "kotlin");
  const sourceFiles = await getCompilationSourceFiles(entryPath, "kotlin");
  const artifactDir = useCache
    ? join(
        await getCacheBaseDir(cwd, config),
        buildCacheKey({
          entryPath,
          sourceSignature,
          compileCommand: config.kotlinCompiler,
        }),
      )
    : await mkdtemp(join(tmpdir(), "exvex-kotlin-"));
  const artifactPath = join(
    artifactDir,
    `${basename(entryPath, extname(entryPath))}.jar`,
  );

  if (!useCache || !(await pathExists(artifactPath))) {
    await mkdir(artifactDir, { recursive: true });
    const compileInput = sourceFiles.some((file) => !file.endsWith(".kt"))
      ? await stageMultiFileSourcesWithExtension({
          entryPath,
          sourceFiles,
          artifactDir,
          requiredExtension: ".kt",
        })
      : null;
    const compileSourceFiles = compileInput?.stagedSourceFiles ?? sourceFiles;
    const compileCwd = compileInput?.stagedSourceDir ?? cwd;

    const compileArgs = [
      ...compileParts.slice(1),
      ...compileSourceFiles,
      "-include-runtime",
      "-d",
      artifactPath,
    ];
    const compileResult = await runProcess({
      command: compileParts[0],
      args: compileArgs,
      cwd: compileCwd,
      timeoutMs: compileTimeoutMs,
    });

    if (compileResult.timedOut || compileResult.exitCode !== 0) {
      await cleanupTempArtifacts(
        artifactDir,
        useCache,
        config.retainTempArtifactsOnFailure,
      );
      throw new Error(
        getProcessFailureMessage(
          "Compilation (kotlin)",
          [compileParts[0], ...compileArgs],
          compileResult,
        ),
      );
    }
  }

  return {
    command: [...runtimeParts, "-jar", artifactPath],
    artifactPath,
    cleanupPath: useCache ? undefined : artifactDir,
  };
}

async function prepareJavaExecution({
  entryPath,
  config,
  cwd,
  timeoutMs,
  useCache,
}: {
  entryPath: string;
  config: ResolvedExvexConfig;
  cwd: string;
  timeoutMs: number;
  useCache: boolean;
}): Promise<PreparedExecution> {
  const compileParts = splitCommand(config.javaCompiler);
  const runtimeParts = splitCommand(config.javaRuntime);

  if (compileParts.length === 0) {
    throw new Error("Invalid compile command for java.");
  }

  if (runtimeParts.length === 0) {
    throw new Error("Invalid runtime command for java.");
  }

  const compileTimeoutMs = getCompileTimeoutMs(timeoutMs);
  const sourceContent = await readFile(entryPath, "utf8");
  const packageName =
    sourceContent.match(
      /^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m,
    )?.[1] ?? "";
  const declaredMainClass = getJavaDeclaredMainClassName(sourceContent);
  const sourceSignature = await getSourceSignature(entryPath, "java");
  const artifactDir = useCache
    ? join(
        await getCacheBaseDir(cwd, config),
        buildCacheKey({
          entryPath,
          sourceSignature,
          compileCommand: config.javaCompiler,
        }),
      )
    : await mkdtemp(join(tmpdir(), "exvex-java-"));
  const sourceFiles = await getCompilationSourceFiles(entryPath, "java");
  const mainClass = declaredMainClass ?? basename(entryPath, ".java");
  const runtimeMainClass = packageName
    ? `${packageName}.${mainClass}`
    : mainClass;
  const classPathSegments = runtimeMainClass.split(".");
  const mainClassFile = join(artifactDir, ...classPathSegments) + ".class";

  if (!useCache || !(await pathExists(mainClassFile))) {
    await mkdir(artifactDir, { recursive: true });
    const compileInput = sourceFiles.some((file) => !file.endsWith(".java"))
      ? await stageMultiFileSourcesWithExtension({
          entryPath,
          sourceFiles,
          artifactDir,
          requiredExtension: ".java",
          resolveExtensionlessTargetBaseName: (_sourceFile, sourceText) =>
            getJavaDeclaredMainClassName(sourceText),
        })
      : null;
    const compileSourceFiles = compileInput?.stagedSourceFiles ?? sourceFiles;
    const compileCwd = compileInput?.stagedSourceDir ?? cwd;

    const compileResult = await runProcess({
      command: compileParts[0],
      args: [
        ...compileParts.slice(1),
        "-d",
        artifactDir,
        ...compileSourceFiles,
      ],
      cwd: compileCwd,
      timeoutMs: compileTimeoutMs,
    });

    if (compileResult.timedOut || compileResult.exitCode !== 0) {
      await cleanupTempArtifacts(
        artifactDir,
        useCache,
        config.retainTempArtifactsOnFailure,
      );
      throw new Error(
        getProcessFailureMessage(
          "Compilation (java)",
          [
            compileParts[0],
            ...compileParts.slice(1),
            "-d",
            artifactDir,
            ...compileSourceFiles,
          ],
          compileResult,
        ),
      );
    }
  }

  return {
    command: [...runtimeParts, "-cp", artifactDir, runtimeMainClass],
    artifactPath: artifactDir,
    cleanupPath: useCache ? undefined : artifactDir,
  };
}

async function prepareExecution({
  entryPath,
  language,
  config,
  cwd,
  timeoutMs,
  useCache,
}: {
  entryPath: string;
  language: SupportedLanguage;
  config: ResolvedExvexConfig;
  cwd: string;
  timeoutMs: number;
  useCache: boolean;
}): Promise<PreparedExecution> {
  if (language === "javascript") {
    const runtimeParts = splitCommand(config.javascript);

    if (runtimeParts.length === 0) {
      throw new Error("Invalid runtime command for javascript.");
    }

    return {
      command: [...runtimeParts, entryPath],
    };
  }

  if (language === "python") {
    const runtimeParts = splitCommand(config.python);

    if (runtimeParts.length === 0) {
      throw new Error("Invalid runtime command for python.");
    }

    return {
      command: [...runtimeParts, entryPath],
    };
  }

  if (language === "php") {
    const runtimeParts = splitCommand(config.php);

    if (runtimeParts.length === 0) {
      throw new Error("Invalid runtime command for php.");
    }

    return {
      command: [...runtimeParts, entryPath],
    };
  }

  if (language === "ruby") {
    const runtimeParts = splitCommand(config.ruby);

    if (runtimeParts.length === 0) {
      throw new Error("Invalid runtime command for ruby.");
    }

    return {
      command: [...runtimeParts, entryPath],
    };
  }

  if (language === "java") {
    return await prepareJavaExecution({
      entryPath,
      config,
      cwd,
      timeoutMs,
      useCache,
    });
  }

  if (language === "kotlin") {
    return await prepareKotlinExecution({
      entryPath,
      config,
      cwd,
      timeoutMs,
      useCache,
    });
  }

  return await prepareNativeExecution({
    entryPath,
    language,
    config,
    cwd,
    timeoutMs,
    useCache,
  });
}

export function buildCacheKey({
  entryPath,
  sourceSignature,
  compileCommand,
}: {
  entryPath: string;
  sourceSignature: string;
  compileCommand: string;
}) {
  return createHash("sha1")
    .update(`${COMPILE_CACHE_VERSION}\0${entryPath}\0${sourceSignature}\0${compileCommand}`)
    .digest("hex")
    .slice(0, 16);
}

export function describeFirstDifference(expected: string, actual: string) {
  const normalizedExpected = normalizeOutput(expected);
  const normalizedActual = normalizeOutput(actual);

  if (normalizedExpected === normalizedActual) {
    return "Outputs match.";
  }

  const expectedLines = normalizedExpected.split("\n");
  const actualLines = normalizedActual.split("\n");
  const lineCount = Math.max(expectedLines.length, actualLines.length);

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const expectedLine = expectedLines[lineIndex] ?? "";
    const actualLine = actualLines[lineIndex] ?? "";

    if (expectedLine === actualLine) {
      continue;
    }

    let column = 1;
    const maxCommonLength = Math.min(expectedLine.length, actualLine.length);

    while (
      column <= maxCommonLength &&
      expectedLine[column - 1] === actualLine[column - 1]
    ) {
      column += 1;
    }

    return `First difference at line ${lineIndex + 1}, column ${column}: expected ${JSON.stringify(expectedLine)}, received ${JSON.stringify(actualLine)}.`;
  }

  throw new Error(
    "Internal error: outputs differ but no differing line was found.",
  );
}

export async function loadConfig(cwd: string = process.cwd()) {
  const configPath = resolve(cwd, CONFIG_FILENAME);

  if (!(await pathExists(configPath))) {
    return resolveConfig();
  }

  const configStat = await stat(configPath);

  if (!configStat.isFile()) {
    throw new Error(`${CONFIG_FILENAME} must be a file, not a directory.`);
  }

  let parsed: ExvexConfig;

  try {
    const rawConfig = await readFile(configPath, "utf8");
    const configText = rawConfig.startsWith("\uFEFF")
      ? rawConfig.slice(1)
      : rawConfig;
    parsed = JSON.parse(configText) as ExvexConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse ${CONFIG_FILENAME}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(
      `Failed to parse ${CONFIG_FILENAME}: top-level JSON value must be an object.`,
    );
  }

  return resolveConfig(parsed);
}

export async function resolveEntryFile(
  cwd: string,
  requestedEntry?: string,
): Promise<string> {
  return (await resolveEntryFileWithLanguage(cwd, requestedEntry)).path;
}

async function resolveEntryFileWithLanguage(
  cwd: string,
  requestedEntry?: string,
): Promise<{ path: string; language: SupportedLanguage }> {
  if (requestedEntry !== undefined) {
    if (requestedEntry.trim() === "") {
      throw new Error("Entry file must not be empty.");
    }

    const entryPath = resolveFrom(cwd, requestedEntry);
    await ensureFileExists(entryPath, "Entry file");

    const detectedLanguage = await detectLanguageForFile(entryPath);

    if (!detectedLanguage) {
      throw new Error(
        `Could not detect a supported language for ${entryPath}. Supported extensions: ${SUPPORTED_SOURCE_EXTENSIONS.join(", ")}. For extensionless scripts, add a shebang such as #!/usr/bin/env node or #!/usr/bin/env python3.`,
      );
    }

    return { path: entryPath, language: detectedLanguage };
  }

  const detectedFiles = await getDetectedSourceFiles(cwd);
  const candidateFiles = detectedFiles.map((entry) => entry.name);

  const mainMatches = MAIN_FILE_NAMES.filter((name) =>
    candidateFiles.includes(name),
  );

  if (mainMatches.length === 1) {
    const matched = detectedFiles.find((f) => f.name === mainMatches[0])!;
    return { path: matched.path, language: matched.language };
  }

  if (mainMatches.length > 1) {
    throw new Error(
      `Multiple main.* files found: ${mainMatches.join(", ")}. Please specify an entry file explicitly.`,
    );
  }

  if (candidateFiles.length === 1) {
    return {
      path: detectedFiles[0]!.path,
      language: detectedFiles[0]!.language,
    };
  }

  if (candidateFiles.length === 0) {
    throw new Error(
      `No supported source files found in ${cwd}. Supported extensions: ${SUPPORTED_SOURCE_EXTENSIONS.join(", ")}. Extensionless scripts are supported when they include a recognizable shebang.`,
    );
  }

  throw new Error(
    `Multiple runnable files found: ${detectedFiles
      .map((entry) => `${entry.name} (${entry.language})`)
      .join(", ")}. Please specify an entry file explicitly.`,
  );
}

export async function runFile(request: RunRequest): Promise<RunResult> {
  const cwd = resolve(request.cwd ?? process.cwd());
  const config = await loadConfig(cwd);
  const { path: entryPath, language } = await resolveEntryFileWithLanguage(
    cwd,
    request.entryFile,
  );
  const timeoutMs = request.timeoutMs ?? config.timeout;
  ensureNonNegativeInteger(timeoutMs, "timeoutMs");
  const useCache = request.useCache ?? true;
  const execution = await prepareExecution({
    entryPath,
    language,
    config,
    cwd,
    timeoutMs,
    useCache,
  });
  let runtimeResult: ProcessRunResult | undefined;
  try {
    let inputText: string | undefined = request.inputText;

    if (inputText === undefined && request.inputFile) {
      const resolvedInputFile = resolveFrom(cwd, request.inputFile);
      await ensureFileExists(resolvedInputFile, "Input file");
      inputText = await readFile(resolvedInputFile, "utf8");
    }
    runtimeResult = await runProcess({
      command: execution.command[0],
      args: execution.command.slice(1),
      cwd,
      timeoutMs,
      env: getRuntimeEnvironment(),
      envPathPrepend: execution.envPathPrepend,
      inputText,
      inputStream: inputText === undefined ? request.stdin : null,
      stdoutStream: request.stdout,
      stderrStream: request.stderr,
    });

    return {
      entryFile: entryPath,
      language,
      command: execution.command,
      exitCode: runtimeResult.exitCode,
      stdout: runtimeResult.stdout,
      stderr: runtimeResult.stderr,
      durationMs: runtimeResult.durationMs,
      timeoutMs,
      timedOut: runtimeResult.timedOut,
      artifactPath: execution.artifactPath,
    };
  } finally {
    if (execution.cleanupPath) {
      const retainArtifacts = runtimeResult
        ? runtimeResult.timedOut || runtimeResult.exitCode !== 0
          ? config.retainTempArtifactsOnFailure
          : config.retainTempArtifactsOnSuccess
        : config.retainTempArtifactsOnFailure;
      await cleanupTempArtifacts(
        execution.cleanupPath,
        useCache,
        retainArtifacts,
      );
    }
  }
}

export async function discoverJudgeCases({
  cwd,
  inputDir,
  outputDir,
}: {
  cwd: string;
  inputDir: string;
  outputDir: string;
}): Promise<JudgeCase[]> {
  const resolvedInputDir = resolveFrom(cwd, inputDir);
  const resolvedOutputDir = resolveFrom(cwd, outputDir);

  await ensureDirectoryExists(resolvedInputDir, "Input directory");
  await ensureDirectoryExists(resolvedOutputDir, "Output directory");

  const inputEntries = await readdir(resolvedInputDir, { withFileTypes: true });
  const outputEntries = await readdir(resolvedOutputDir, {
    withFileTypes: true,
  });
  const outputByBaseName = new Map(
    outputEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
      .map((entry) => [
        basename(entry.name, ".txt"),
        join(resolvedOutputDir, entry.name),
      ]),
  );
  const inputCaseNames = inputEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => basename(entry.name, ".txt"));
  const missingOutputs = inputCaseNames.filter(
    (name) => !outputByBaseName.has(name),
  );
  const inputCaseNameSet = new Set(inputCaseNames);
  const missingInputs = [...outputByBaseName.keys()].filter(
    (name) => !inputCaseNameSet.has(name),
  );

  if (missingOutputs.length > 0 || missingInputs.length > 0) {
    const problems: string[] = [];

    if (missingOutputs.length > 0) {
      problems.push(
        `missing expected outputs for: ${sortCaseNames(missingOutputs).join(", ")}`,
      );
    }

    if (missingInputs.length > 0) {
      problems.push(
        `missing inputs for: ${sortCaseNames(missingInputs).join(", ")}`,
      );
    }

    throw new Error(
      `Judge case directories are incomplete: ${problems.join("; ")}.`,
    );
  }

  const matchedCases = inputCaseNames.filter((name) =>
    outputByBaseName.has(name),
  );

  if (matchedCases.length === 0) {
    throw new Error(
      `No matching judge cases found in ${resolvedInputDir} and ${resolvedOutputDir}.`,
    );
  }

  return sortCaseNames(matchedCases).map((name) => ({
    name,
    inputPath: join(resolvedInputDir, `${name}.txt`),
    outputPath: outputByBaseName.get(name)!,
  }));
}

export async function runJudge({
  entryFile,
  cwd,
  inputDir,
  outputDir,
  timeoutMs,
  useCache = true,
}: {
  entryFile?: string;
  cwd?: string;
  inputDir?: string;
  outputDir?: string;
  timeoutMs?: number;
  useCache?: boolean;
}): Promise<JudgeSummary> {
  const workingDirectory = resolve(cwd ?? process.cwd());
  const config = await loadConfig(workingDirectory);
  if (timeoutMs !== undefined) {
    ensureNonNegativeInteger(timeoutMs, "timeoutMs");
  }
  const resolvedEntryFile = await resolveEntryFile(workingDirectory, entryFile);
  const entryDirectory = dirname(resolvedEntryFile);
  const resolvedInputDir =
    inputDir !== undefined
      ? inputDir
      : config.inputDir === "input"
        ? relative(workingDirectory, join(entryDirectory, "input")) || "input"
        : config.inputDir;
  const resolvedOutputDir =
    outputDir !== undefined
      ? outputDir
      : config.outputDir === "output"
        ? relative(workingDirectory, join(entryDirectory, "output")) || "output"
        : config.outputDir;
  const cases = await discoverJudgeCases({
    cwd: workingDirectory,
    inputDir: resolvedInputDir,
    outputDir: resolvedOutputDir,
  });
  const results: JudgeCaseResult[] = [];

  for (const judgeCase of cases) {
    const expected = await readFile(judgeCase.outputPath, "utf8");
    const runResult = await runFile({
      entryFile: resolvedEntryFile,
      cwd: workingDirectory,
      inputFile: judgeCase.inputPath,
      timeoutMs,
      useCache,
    });

    const passed =
      !runResult.timedOut &&
      runResult.exitCode === 0 &&
      normalizeOutput(expected) === normalizeOutput(runResult.stdout);
    let diff: string | undefined;

    if (runResult.timedOut) {
      diff = `Timed out after ${runResult.timeoutMs}ms.`;
    } else if (runResult.exitCode !== 0) {
      diff = `Exited with code ${runResult.exitCode ?? "unknown"}.`;
    } else if (!passed) {
      diff = describeFirstDifference(expected, runResult.stdout);
    }

    results.push({
      ...judgeCase,
      passed,
      expected,
      actual: runResult.stdout,
      durationMs: runResult.durationMs,
      diff,
      runResult,
    });
  }

  const passed = results.filter((result) => result.passed).length;

  return {
    entryFile: resolvedEntryFile,
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: results,
  };
}

export async function writeStressArtifacts({
  cwd,
  inputText,
  solutionOutput,
  bruteOutput,
  metadata,
  artifactMode = "overwrite",
}: {
  cwd: string;
  inputText: string;
  solutionOutput: string;
  bruteOutput: string;
  metadata?: StressArtifactMetadata;
  artifactMode?: "overwrite" | "timestamp";
}) {
  const artifactDir =
    artifactMode === "timestamp" && metadata
      ? resolve(
          cwd,
          ".exvex/stress",
          createStressArtifactDirectoryName(metadata.failingIteration),
        )
      : resolve(cwd, ".exvex/stress");
  await mkdir(artifactDir, { recursive: true });

  const failingInputPath = join(artifactDir, "failing-input.txt");
  const solutionOutputPath = join(artifactDir, "solution-output.txt");
  const bruteOutputPath = join(artifactDir, "brute-output.txt");
  const artifactMetadataPath = join(artifactDir, "metadata.json");

  await writeFile(failingInputPath, inputText);
  await writeFile(solutionOutputPath, solutionOutput);
  await writeFile(bruteOutputPath, bruteOutput);
  if (metadata) {
    await writeFile(
      artifactMetadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
  } else {
    await rm(artifactMetadataPath, { force: true });
  }

  return {
    artifactDir,
    failingInputPath,
    solutionOutputPath,
    bruteOutputPath,
    artifactMetadataPath,
  };
}

export async function runStress(
  request: StressRequest,
): Promise<StressSummary> {
  const cwd = resolve(request.cwd ?? process.cwd());
  const config = await loadConfig(cwd);
  const iterations = request.iterations ?? DEFAULT_STRESS_ITERATIONS;
  const timeoutMs = request.timeoutMs ?? config.timeout;
  ensurePositiveInteger(iterations, "iterations");
  ensureNonNegativeInteger(timeoutMs, "timeoutMs");
  const useCache = request.useCache ?? true;
  const solutionFile = await resolveEntryFile(cwd, request.solutionFile);
  const bruteFile = await resolveEntryFile(cwd, request.bruteFile);
  const generatorFile = await resolveEntryFile(cwd, request.generatorFile);

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const generatorResult = await runFile({
      entryFile: generatorFile,
      cwd,
      timeoutMs,
      useCache,
    });

    if (generatorResult.timedOut) {
      const message = `Generator timed out after ${timeoutMs}ms.`;
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText: generatorResult.stdout,
        solutionOutput: "",
        bruteOutput: "",
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "timeout",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "timeout",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
      };
    }

    if (generatorResult.exitCode !== 0) {
      const message = `Generator exited with code ${generatorResult.exitCode}.`;
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText: generatorResult.stdout,
        solutionOutput: "",
        bruteOutput: "",
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "generator-error",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "generator-error",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
      };
    }

    const inputText = generatorResult.stdout;
    const solutionResult = await runFile({
      entryFile: solutionFile,
      cwd,
      inputText,
      timeoutMs,
      useCache,
    });
    const bruteResult = await runFile({
      entryFile: bruteFile,
      cwd,
      inputText,
      timeoutMs,
      useCache,
    });

    if (solutionResult.timedOut || bruteResult.timedOut) {
      const message =
        solutionResult.timedOut && bruteResult.timedOut
          ? `Solution and brute-force programs timed out after ${timeoutMs}ms.`
          : solutionResult.timedOut
            ? `Solution timed out after ${timeoutMs}ms.`
            : `Brute-force program timed out after ${timeoutMs}ms.`;
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText,
        solutionOutput: solutionResult.stdout,
        bruteOutput: bruteResult.stdout,
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "timeout",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "timeout",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
        solutionResult,
        bruteResult,
      };
    }

    if (solutionResult.exitCode !== 0) {
      const message = `Solution exited with code ${solutionResult.exitCode}.`;
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText,
        solutionOutput: solutionResult.stdout,
        bruteOutput: bruteResult.stdout,
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "solution-error",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "solution-error",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
        solutionResult,
        bruteResult,
      };
    }

    if (bruteResult.exitCode !== 0) {
      const message = `Brute-force program exited with code ${bruteResult.exitCode}.`;
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText,
        solutionOutput: solutionResult.stdout,
        bruteOutput: bruteResult.stdout,
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "brute-error",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "brute-error",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
        solutionResult,
        bruteResult,
      };
    }

    if (
      normalizeOutput(solutionResult.stdout) !==
      normalizeOutput(bruteResult.stdout)
    ) {
      const message = describeFirstDifference(
        bruteResult.stdout,
        solutionResult.stdout,
      );
      const artifacts = await writeStressArtifacts({
        cwd,
        inputText,
        solutionOutput: solutionResult.stdout,
        bruteOutput: bruteResult.stdout,
        artifactMode: config.stressArtifactMode,
        metadata: {
          failureReason: "mismatch",
          failingIteration: iteration,
          message,
        },
      });

      return {
        totalIterations: iterations,
        completedIterations: iteration - 1,
        success: false,
        failureReason: "mismatch",
        failingIteration: iteration,
        message,
        artifactDir: artifacts.artifactDir,
        artifactMetadataPath: artifacts.artifactMetadataPath,
        generatorResult,
        solutionResult,
        bruteResult,
      };
    }
  }

  return {
    totalIterations: iterations,
    completedIterations: iterations,
    success: true,
  };
}

export { formatDurationMs, normalizeOutput };
