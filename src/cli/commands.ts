export function formatArg(value: string) {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }

  if (process.platform === "win32") {
    return JSON.stringify(value);
  }

  // POSIX shells still expand $, `, ", and \ inside double quotes.
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

export function formatRunCommand(entryFile: string) {
  return entryFile.startsWith("-")
    ? `npx exvex -- ${formatArg(entryFile)}`
    : `npx exvex ${formatArg(entryFile)}`;
}

export function formatTestCommand(
  entryFile: string,
  inputDir?: string,
  outputDir?: string,
) {
  const args = ["npx", "exvex", "test"];

  if (inputDir && inputDir !== "input" && inputDir !== "input.txt") {
    args.push(`--input-dir=${formatArg(inputDir)}`);
  }

  if (outputDir && outputDir !== "output" && outputDir !== "output.txt") {
    args.push(`--output-dir=${formatArg(outputDir)}`);
  }

  if (entryFile.startsWith("-")) {
    args.push("--", formatArg(entryFile));
  } else {
    args.push(formatArg(entryFile));
  }

  return args.join(" ");
}

export function formatStressCommand(
  solutionFile: string,
  bruteFile: string,
  generatorFile: string,
) {
  const args = [solutionFile, bruteFile, generatorFile].map(formatArg);
  const needsDoubleDash = [solutionFile, bruteFile, generatorFile].some(
    (file) => file.startsWith("-"),
  );

  return `npx exvex stress${needsDoubleDash ? " --" : ""} ${args.join(" ")}`;
}
