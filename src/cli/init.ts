import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "path";
import type { SupportedLanguage } from "../interface";
import {
  formatRunCommand,
  formatStressCommand,
  formatTestCommand,
} from "./commands";

export type InitPreset = "run" | "test" | "stress";
export type InitLanguage = SupportedLanguage;

export interface InitRequest {
  cwd: string;
  language: InitLanguage;
  preset: InitPreset;
  force?: boolean;
  contest?: boolean;
  vscode?: boolean;
  gitignore?: boolean;
  inputDir?: string;
  outputDir?: string;
  entryFile?: string;
  solutionFile?: string;
  bruteFile?: string;
  generatorFile?: string;
}

export interface InitSummary {
  cwd: string;
  language: InitLanguage;
  preset: InitPreset;
  createdPaths: string[];
  overwrittenPaths: string[];
  nextCommand: string;
}

export const INIT_LANGUAGES: InitLanguage[] = [
  "cpp",
  "python",
  "java",
  "javascript",
  "c",
  "go",
  "rust",
  "kotlin",
  "php",
  "ruby",
];

const LANGUAGE_EXTENSION: Record<InitLanguage, string> = {
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

const DEFAULT_CONTEST_PROBLEMS = ["a", "b", "c"];

interface PlannedFile {
  path: string;
  content: string;
}

interface PlannedWorkspace {
  files: PlannedFile[];
  nextCommand: string;
}

function getDefaultEntryFile(language: InitLanguage) {
  if (language === "java" || language === "kotlin") {
    return `Main${LANGUAGE_EXTENSION[language]}`;
  }

  return `main${LANGUAGE_EXTENSION[language]}`;
}

function getDefaultStressFiles(language: InitLanguage) {
  if (language === "java" || language === "kotlin") {
    return {
      solutionFile: `Solution${LANGUAGE_EXTENSION[language]}`,
      bruteFile: `Brute${LANGUAGE_EXTENSION[language]}`,
      generatorFile: `Gen${LANGUAGE_EXTENSION[language]}`,
    };
  }

  return {
    solutionFile: `solution${LANGUAGE_EXTENSION[language]}`,
    bruteFile: `brute${LANGUAGE_EXTENSION[language]}`,
    generatorFile: `gen${LANGUAGE_EXTENSION[language]}`,
  };
}

function normalizeRelativePath(value: string, fieldName: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  if (isAbsolute(trimmed)) {
    throw new Error(`${fieldName} must be relative to current directory.`);
  }

  const normalized = normalize(trimmed);
  const segments = normalized
    .split(/[\\/]+/)
    .filter((segment) => segment !== ".");

  if (segments.some((segment) => segment === "..")) {
    throw new Error(`${fieldName} must stay inside current directory.`);
  }

  return segments.join("/");
}

function validateScaffoldFilePath(
  value: string,
  language: InitLanguage,
  fieldName: string,
) {
  const normalized = normalizeRelativePath(value, fieldName);
  const expectedExtension = LANGUAGE_EXTENSION[language];

  if (extname(normalized).toLowerCase() !== expectedExtension) {
    throw new Error(`${fieldName} must end with "${expectedExtension}".`);
  }

  if (language === "java") {
    const className = basename(normalized, expectedExtension);

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className)) {
      throw new Error(
        `${fieldName} must use a valid Java class name before "${expectedExtension}".`,
      );
    }
  }

  return normalized;
}

function validateScaffoldDirPath(value: string, fieldName: string) {
  return normalizeRelativePath(value, fieldName);
}

function isTextFileSamplePath(path: string) {
  return extname(path).toLowerCase() === ".txt";
}

function getJavaClassName(filePath: string) {
  return basename(filePath, ".java");
}

function renderEntryTemplate(language: InitLanguage, filePath: string) {
  switch (language) {
    case "c":
      return [
        "#include <stdio.h>",
        "",
        "int main(void) {",
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "cpp":
      return [
        "#include <bits/stdc++.h>",
        "using namespace std;",
        "",
        "int main() {",
        "  ios::sync_with_stdio(false);",
        "  cin.tie(nullptr);",
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "python":
      return [
        "def main():",
        "    pass",
        "",
        "",
        'if __name__ == "__main__":',
        "    main()",
        "",
      ].join("\n");
    case "java":
      return [
        `public class ${getJavaClassName(filePath)} {`,
        "  public static void main(String[] args) {",
        "  }",
        "}",
        "",
      ].join("\n");
    case "javascript":
      return ["function main() {", "}", "", "main();", ""].join("\n");
    case "go":
      return ["package main", "", "func main() {", "}", ""].join("\n");
    case "rust":
      return ["fn main() {", "}", ""].join("\n");
    case "kotlin":
      return ["fun main() {", "}", ""].join("\n");
    case "php":
      return ["<?php", ""].join("\n");
    case "ruby":
      return [
        "def main",
        "end",
        "",
        "main if __FILE__ == $PROGRAM_NAME",
        "",
      ].join("\n");
  }
}

function renderStressProgramTemplate(
  language: InitLanguage,
  filePath: string,
  role: "solution" | "brute",
) {
  switch (language) {
    case "c":
      return [
        "#include <stdio.h>",
        "",
        "int main(void) {",
        `  /* TODO: implement ${role}. */`,
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "cpp":
      return [
        "#include <bits/stdc++.h>",
        "using namespace std;",
        "",
        "int main() {",
        "  ios::sync_with_stdio(false);",
        "  cin.tie(nullptr);",
        `  // TODO: implement ${role}.`,
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "python":
      return [
        "def main():",
        `    # TODO: implement ${role}.`,
        "    pass",
        "",
        "",
        'if __name__ == "__main__":',
        "    main()",
        "",
      ].join("\n");
    case "java":
      return [
        `public class ${getJavaClassName(filePath)} {`,
        "  public static void main(String[] args) {",
        `    // TODO: implement ${role}.`,
        "  }",
        "}",
        "",
      ].join("\n");
    case "javascript":
      return [
        "function main() {",
        `  // TODO: implement ${role}.`,
        "}",
        "",
        "main();",
        "",
      ].join("\n");
    case "go":
      return [
        "package main",
        "",
        "func main() {",
        `\t// TODO: implement ${role}.`,
        "}",
        "",
      ].join("\n");
    case "rust":
      return ["fn main() {", `    // TODO: implement ${role}.`, "}", ""].join(
        "\n",
      );
    case "kotlin":
      return ["fun main() {", `    // TODO: implement ${role}`, "}", ""].join(
        "\n",
      );
    case "php":
      return ["<?php", `// TODO: implement ${role}.`, ""].join("\n");
    case "ruby":
      return [
        "def main",
        `  # TODO: implement ${role}.`,
        "end",
        "",
        "main if __FILE__ == $PROGRAM_NAME",
        "",
      ].join("\n");
  }
}

function renderGeneratorTemplate(language: InitLanguage, filePath: string) {
  switch (language) {
    case "c":
      return [
        "#include <stdio.h>",
        "",
        "int main(void) {",
        "  /* TODO: generate randomized input. */",
        '  puts("0");',
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "cpp":
      return [
        "#include <bits/stdc++.h>",
        "using namespace std;",
        "",
        "int main() {",
        "  ios::sync_with_stdio(false);",
        "  cin.tie(nullptr);",
        "  // TODO: generate randomized input.",
        "  cout << 0 << '\\n';",
        "  return 0;",
        "}",
        "",
      ].join("\n");
    case "python":
      return [
        "def main():",
        "    # TODO: generate randomized input.",
        "    print(0)",
        "",
        "",
        'if __name__ == "__main__":',
        "    main()",
        "",
      ].join("\n");
    case "java":
      return [
        `public class ${getJavaClassName(filePath)} {`,
        "  public static void main(String[] args) {",
        "    // TODO: generate randomized input.",
        "    System.out.println(0);",
        "  }",
        "}",
        "",
      ].join("\n");
    case "javascript":
      return [
        "function main() {",
        "  // TODO: generate randomized input.",
        "  console.log(0);",
        "}",
        "",
        "main();",
        "",
      ].join("\n");
    case "go":
      return [
        "package main",
        "",
        'import "fmt"',
        "",
        "func main() {",
        "\t// TODO: generate randomized input.",
        "\tfmt.Println(0)",
        "}",
        "",
      ].join("\n");
    case "rust":
      return [
        "fn main() {",
        "    // TODO: generate randomized input.",
        '    println!("0");',
        "}",
        "",
      ].join("\n");
    case "kotlin":
      return [
        "fun main() {",
        "    // TODO: generate randomized input.",
        "    println(0)",
        "}",
        "",
      ].join("\n");
    case "php":
      return [
        "<?php",
        "// TODO: generate randomized input.",
        'echo "0\\n";',
        "",
      ].join("\n");
    case "ruby":
      return [
        "def main",
        "  # TODO: generate randomized input.",
        "  puts 0",
        "end",
        "",
        "main if __FILE__ == $PROGRAM_NAME",
        "",
      ].join("\n");
  }
}

function makeFile(path: string, content: string): PlannedFile {
  return { path, content };
}

function buildSingleWorkspace(
  request: InitRequest,
  baseDir = "",
): PlannedWorkspace {
  const files: PlannedFile[] = [];
  const prefix = (path: string) => (baseDir ? `${baseDir}/${path}` : path);

  if (request.preset === "stress") {
    const defaults = getDefaultStressFiles(request.language);
    const solutionFile = validateScaffoldFilePath(
      request.solutionFile ?? defaults.solutionFile,
      request.language,
      "Solution file",
    );
    const bruteFile = validateScaffoldFilePath(
      request.bruteFile ?? defaults.bruteFile,
      request.language,
      "Brute file",
    );
    const generatorFile = validateScaffoldFilePath(
      request.generatorFile ?? defaults.generatorFile,
      request.language,
      "Generator file",
    );

    const uniqueFiles = new Set([solutionFile, bruteFile, generatorFile]);
    if (uniqueFiles.size !== 3) {
      throw new Error("Solution, brute, and generator files must be distinct.");
    }

    files.push(
      makeFile(
        prefix(solutionFile),
        renderStressProgramTemplate(request.language, solutionFile, "solution"),
      ),
      makeFile(
        prefix(bruteFile),
        renderStressProgramTemplate(request.language, bruteFile, "brute"),
      ),
      makeFile(
        prefix(generatorFile),
        renderGeneratorTemplate(request.language, generatorFile),
      ),
    );

    return {
      files,
      nextCommand: formatStressCommand(
        prefix(solutionFile),
        prefix(bruteFile),
        prefix(generatorFile),
      ),
    };
  }

  const entryFile = validateScaffoldFilePath(
    request.entryFile ?? getDefaultEntryFile(request.language),
    request.language,
    "Entry file",
  );
  files.push(
    makeFile(
      prefix(entryFile),
      renderEntryTemplate(request.language, entryFile),
    ),
  );

  if (request.preset === "test") {
    const inputDir = validateScaffoldDirPath(
      request.inputDir ?? "input.txt",
      "Input path",
    );
    const outputDir = validateScaffoldDirPath(
      request.outputDir ?? "output.txt",
      "Output path",
    );

    const inputIsFile = isTextFileSamplePath(inputDir);
    const outputIsFile = isTextFileSamplePath(outputDir);

    if (inputIsFile !== outputIsFile) {
      throw new Error(
        "Input and output sample paths must both be .txt files or both be directories.",
      );
    }

    if (inputIsFile) {
      files.push(
        makeFile(prefix(inputDir), ""),
        makeFile(prefix(outputDir), ""),
      );
    } else {
      files.push(
        makeFile(prefix(`${inputDir}/1.txt`), ""),
        makeFile(prefix(`${outputDir}/1.txt`), ""),
      );
    }

    return {
      files,
      nextCommand: formatTestCommand(
        prefix(entryFile),
        prefix(inputDir),
        prefix(outputDir),
      ),
    };
  }

  return {
    files,
    nextCommand: formatRunCommand(prefix(entryFile)),
  };
}

function buildContestWorkspaces(request: InitRequest) {
  const files: PlannedFile[] = [];
  let firstNextCommand = "";

  for (const problemDir of DEFAULT_CONTEST_PROBLEMS) {
    const workspace = buildSingleWorkspace(request, problemDir);
    files.push(...workspace.files);

    if (!firstNextCommand) {
      firstNextCommand = workspace.nextCommand;
    }
  }

  return {
    files,
    nextCommand: firstNextCommand,
  };
}

function buildVscodeTasks(request: InitRequest) {
  const command = buildSingleWorkspace(request).nextCommand;

  return (
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "exvex: run active scaffold",
            type: "shell",
            command,
            ...(request.contest
              ? {
                  options: {
                    cwd: "${workspaceFolder}/a",
                  },
                }
              : {}),
            problemMatcher: [],
          },
        ],
      },
      null,
      2,
    ) + "\n"
  );
}

async function getExistingPathType(path: string) {
  try {
    const stats = await stat(path);
    return stats.isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function assertParentDirectoriesAvailable(
  cwd: string,
  relativePath: string,
) {
  const segments = normalize(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean);

  for (let index = 0; index < segments.length - 1; index += 1) {
    const parentRelativePath = segments.slice(0, index + 1).join("/");
    const existingType = await getExistingPathType(
      join(cwd, parentRelativePath),
    );

    if (existingType === "file") {
      throw new Error(
        `Cannot create directory "${parentRelativePath}" because a file already exists there.`,
      );
    }
  }
}

async function appendGitignore(
  cwd: string,
  createdPaths: string[],
  overwrittenPaths: string[],
) {
  const gitignorePath = join(cwd, ".gitignore");
  const existingType = await getExistingPathType(gitignorePath);

  if (existingType === "directory") {
    throw new Error(
      'Cannot write file ".gitignore" because a directory already exists there.',
    );
  }

  if (existingType === "file") {
    const existingContent = await readFile(gitignorePath, "utf8");
    const lines = existingContent.split(/\r?\n/).filter(Boolean);
    if (lines.includes(".exvex/")) {
      return;
    }

    const needsNewline =
      existingContent.length > 0 && !existingContent.endsWith("\n");
    await writeFile(
      gitignorePath,
      `${existingContent}${needsNewline ? "\n" : ""}.exvex/\n`,
      "utf8",
    );
    overwrittenPaths.push(".gitignore");
    return;
  }

  await writeFile(gitignorePath, ".exvex/\n", "utf8");
  createdPaths.push(".gitignore");
}

async function validateGitignoreTarget(cwd: string) {
  const gitignorePath = join(cwd, ".gitignore");
  const existingType = await getExistingPathType(gitignorePath);

  if (existingType === "directory") {
    throw new Error(
      'Cannot write file ".gitignore" because a directory already exists there.',
    );
  }
}

export async function initProject(request: InitRequest): Promise<InitSummary> {
  const workspacePlan = request.contest
    ? buildContestWorkspaces(request)
    : buildSingleWorkspace(request);
  const files = [...workspacePlan.files];

  if (request.vscode) {
    files.push(makeFile(".vscode/tasks.json", buildVscodeTasks(request)));
  }

  const uniquePaths = new Set(files.map((file) => file.path));
  if (uniquePaths.size !== files.length) {
    throw new Error("Scaffold plan produced duplicate file paths.");
  }

  if (request.gitignore) {
    await validateGitignoreTarget(request.cwd);
  }

  const overwrittenPaths: string[] = [];
  const createdPaths: string[] = [];

  for (const file of files) {
    const absolutePath = join(request.cwd, file.path);
    await assertParentDirectoriesAvailable(request.cwd, file.path);
    const existingType = await getExistingPathType(absolutePath);

    if (existingType === "directory") {
      throw new Error(
        `Cannot write file "${file.path}" because a directory already exists there.`,
      );
    }

    if (existingType === "file") {
      if (!request.force) {
        throw new Error(
          `Refusing to overwrite existing file "${file.path}". Pass --force to overwrite scaffold files.`,
        );
      }

      overwrittenPaths.push(file.path);
    } else {
      createdPaths.push(file.path);
    }
  }

  for (const file of files) {
    await mkdir(join(request.cwd, dirname(file.path)), { recursive: true });
    await writeFile(join(request.cwd, file.path), file.content, "utf8");
  }

  if (request.gitignore) {
    await appendGitignore(request.cwd, createdPaths, overwrittenPaths);
  }

  return {
    cwd: request.cwd,
    language: request.language,
    preset: request.preset,
    createdPaths,
    overwrittenPaths,
    nextCommand: workspacePlan.nextCommand,
  };
}
