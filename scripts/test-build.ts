import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

interface BuiltCliModule {
  getHelpText: () => string;
  runCli: (
    args: string[],
    dependencies: {
      cwd: () => string;
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      isTty: boolean;
      logger: {
        log: (message: unknown) => void;
        error: (message: unknown) => void;
      };
      runFile: () => Promise<never>;
      runJudge: () => Promise<never>;
      runStress: () => Promise<never>;
    },
  ) => Promise<number>;
}

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const distEntryPath = join(rootDir, "dist/index.js");

await assert.doesNotReject(
  access(distEntryPath),
  "Built artifact missing at dist/index.js. Run `npm run build` first.",
);

const { getHelpText, runCli } = (await import(
  `${pathToFileURL(distEntryPath).href}?t=${Date.now()}`
)) as BuiltCliModule;

const helpText = getHelpText();

assert.match(helpText, /Usage:/, "Built CLI help output is missing Usage.");
assert.match(
  helpText,
  /exvex test \[entry\]/,
  "Built CLI help output is missing the test command.",
);
assert.match(helpText, /\.go/, "Built CLI help output is missing .go support.");
assert.match(helpText, /\.rb/, "Built CLI help output is missing .rb support.");

const loggerMessages: string[] = [];
const loggerErrors: string[] = [];
const exitCode = await runCli(["--unknown"], {
  cwd: () => rootDir,
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  isTty: false,
  logger: {
    log: (message: unknown) => loggerMessages.push(String(message)),
    error: (message: unknown) => loggerErrors.push(String(message)),
  },
  runFile: async () => {
    throw new Error("runFile should not be called for argument validation.");
  },
  runJudge: async () => {
    throw new Error("runJudge should not be called for argument validation.");
  },
  runStress: async () => {
    throw new Error("runStress should not be called for argument validation.");
  },
});

assert.equal(
  exitCode,
  1,
  "Built CLI should return a failing exit code for invalid options.",
);
assert.equal(
  loggerMessages.length,
  0,
  "Built CLI should not log normal output for invalid options.",
);
assert.match(
  loggerErrors.join("\n"),
  /Unknown option: --unknown/,
  "Built CLI validation error did not mention the unknown option.",
);

process.stdout.write("Build artifact checks passed.\n");
