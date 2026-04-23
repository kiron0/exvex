# exvex

[![npm version](https://img.shields.io/npm/v/exvex.svg?style=flat-square)](https://www.npmjs.com/package/exvex)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

**exvex is a CLI for running, judging, and stress-testing competitive programming solutions locally.**

It gives you one local workflow for the repetitive parts of problem solving: run a solution from source, check it against sample cases, and compare it against a brute-force implementation when you need stress testing.

exvex is built for competitive programmers who switch between languages and want faster feedback than a pile of ad hoc shell commands, compiler invocations, and one-off scripts.

## Features

- Run supported source files with one command
- Use one CLI for run, sample judging, and stress testing
- Detect languages from file extensions, shebangs, and common source patterns
- Cache compiled C, C++, Java, Go, Rust, and Kotlin artifacts
- Judge `input/*.txt` against `output/*.txt`
- Stress test a solution against a brute-force implementation
- Scaffold ready-to-use workspaces with `exvex init`
- Customize compiler commands and defaults with `exvex.config.json`
- Emit structured `--json` output for editor and CI integrations
- Prompt interactively when launched in a TTY without arguments, including optional `--json`

## Installation

```bash
npm install -g exvex
```

Or run it without a global install:

```bash
npx exvex --help
```

Node.js 18 or newer is required.

## Usage

### Run a file

```bash
exvex main.cpp
exvex script.py --input=sample.txt
exvex script.py --input sample.txt
exvex solution.java --timeout=3000
exvex solution.java --timeout 3000
```

When you run `exvex` with no arguments in an interactive terminal, it prompts for mode, required files, timeout, cache choice, and optional JSON output.

### Initialize a workspace

```bash
exvex init
exvex init cpp
exvex init python --preset=run
exvex init python --run
exvex init cpp --stress
exvex init cpp --test --yes
exvex init java --preset=stress --force
exvex init cpp --json
exvex init cpp --contest --vscode --gitignore
exvex init cpp --input-dir=samples/in --output-dir=samples/out
```

`exvex init` scaffolds starter files so users do not need to hand-create `main.*`, `input/`, `output/`, or stress-test files.

- Default preset is `test`
- Bare `exvex init` in an interactive terminal opens a wizard
- `test` preset creates `main.*`, `input/1.txt`, and `output/1.txt`
- `stress` preset creates `solution.*`, `brute.*`, and `gen.*`
- `--run`, `--test`, and `--stress` are shortcuts for `--preset=...`
- `--yes` accepts init defaults without prompting
- `--json` prints machine-readable scaffold summary for editor/extensions
- `--contest` creates `a/`, `b/`, and `c/` problem folders
- `--vscode` generates `.vscode/tasks.json` using normalized scaffold paths; contest tasks run from `a/` via VS Code `cwd`
- `--gitignore` appends `.exvex/` to `.gitignore`
- `--input-dir` and `--output-dir` customize sample folder names during init test preset
- init file and directory names must stay relative to current directory
- stress init file names must be distinct from each other
- `--force` overwrites existing scaffold files

### Judge sample cases

```bash
exvex test
exvex test main.cpp
exvex test --input-dir=samples/in --output-dir=samples/out
exvex test --input-dir samples/in --output-dir samples/out
```

`exvex test` auto-detects an entry file in the current directory by preferring a single `main.*` file and otherwise requiring exactly one supported source file.

### Stress test

```bash
exvex stress solution.cpp brute.cpp gen.cpp
exvex stress solution.py brute.py gen.py --iterations=500 --timeout=2000
exvex stress solution.py brute.py gen.py --iterations 500 --timeout 2000
exvex stress solution.py brute.py gen.py --json
```

All long options support both forms: `--option=value` and `--option value`.

To pass a positional filename that starts with `-`, stop option parsing first:

```bash
exvex -- --help
exvex test -- --main.py
exvex stress -- --solution.py --brute.py --gen.py
```

On first mismatch or runtime failure, exvex writes failing input, both outputs, and `metadata.json` to `.exvex/stress/`. Set `stressArtifactMode` to `"timestamp"` if you want each failure preserved in its own directory instead of overwriting latest one.

### Options at a glance

- `--input FILE` or `--input=FILE`: read stdin from file in run mode
- `--input-dir DIR` or `--input-dir=DIR`: override judge input directory
- `--output-dir DIR` or `--output-dir=DIR`: override judge output directory
- `--iterations N` or `--iterations=N`: set stress-test iteration count, default `100`
- `--preset NAME` or `--preset=NAME`: init preset, one of `run`, `test`, `stress`
- `--run`, `--test`, `--stress`: init preset shortcuts for `run`, `test`, `stress`
- `--json`: print machine-readable JSON for run, judge, or stress mode
- `--timeout MS` or `--timeout=MS`: set timeout in milliseconds, default `2000`
- `--timeout 0`: disable timeout entirely
- `--no-cache`: bypass compile cache for current invocation
- `--contest`: scaffold `a/`, `b/`, `c/` problem folders during init
- `--vscode`: generate `.vscode/tasks.json` during init
- `--gitignore`: append `.exvex/` to `.gitignore` during init
- `--entry FILE`: init entry filename for run/test presets
- `--input-dir DIR`, `--output-dir DIR`: init custom sample dirs for test preset
- `--solution FILE`, `--brute FILE`, `--generator FILE`: init stress filenames
- `--yes`: accept init defaults without prompting
- `--force`: overwrite existing init scaffold files
- `--version` or `-v`: print CLI version
- `--help` or `-h`: print help
- `--`: stop option parsing so later arguments are treated as positional filenames

## Behavior Notes

- Compiled artifacts are cached under `.exvex/cache/` by default for C, C++, Java, Go, Rust, and Kotlin
- `--no-cache` uses temporary build artifacts instead of reusing cached ones
- Judge mode defaults to `input/` and `output/` directories unless overridden in config or CLI flags
- Output comparison normalizes line endings and ignores trailing whitespace at end of output
- Stress failures write `failing-input.txt`, `solution-output.txt`, and `brute-output.txt` under `.exvex/stress/`
- Stress failures also write `metadata.json` with iteration number, failure reason, and summary message
- JSON error output includes structured codes for parse, config, and missing-toolchain failures
- Extensionless files work when exvex can detect language from a shebang or recognizable source pattern
- `exvex init` defaults to a C++ sample-judge scaffold when run non-interactively with no extra flags
- init language defaults to `cpp`; init preset defaults to `test`
- Generated VS Code tasks reuse normalized scaffold paths, so inputs like `./samples\\in` become stable `samples/in` task arguments
- `retainTempArtifactsOnSuccess` and `retainTempArtifactsOnFailure` control whether `--no-cache` build artifacts are kept
- `stressArtifactMode` controls whether stress failures overwrite `.exvex/stress/` or create timestamped directories

## Supported Languages

- `.c` via `gcc -O2 -std=c11`
- `.cpp` via `g++ -O2 -std=c++17`
- `.py` via `python3`
- `.java` via `javac` + `java`
- `.js` via `node`
- `.go` via `go build`
- `.rs` via `rustc -O`
- `.kt` via `kotlinc` + `java -jar`
- `.php` via `php`
- `.rb` via `ruby`

Extensionless scripts are also supported when they include a recognizable shebang such as `#!/usr/bin/env node` or `#!/usr/bin/env python3`.

## Configuration

Create `exvex.config.json` in the working directory to override defaults:

```json
{
  "c": "gcc -O2 -std=c11",
  "cpp": "g++ -O2 -std=c++17",
  "python": "python3",
  "javaCompiler": "javac",
  "javaRuntime": "java",
  "javascript": "node",
  "go": "go build",
  "rust": "rustc -O",
  "kotlinCompiler": "kotlinc",
  "kotlinRuntime": "java",
  "php": "php",
  "ruby": "ruby",
  "timeout": 2000,
  "cacheDir": ".exvex/cache",
  "inputDir": "input",
  "outputDir": "output",
  "retainTempArtifactsOnSuccess": false,
  "retainTempArtifactsOnFailure": false,
  "stressArtifactMode": "overwrite"
}
```

Config command values are tokenized directly by exvex. Keep them as executable-plus-arguments strings such as `"python3"` or `"g++ -O2 -std=c++20"`, not shell pipelines or shell-only syntax.

## Sample Directory Layout

```text
problem/
|-- main.cpp
|-- input/
|   |-- 1.txt
|   `-- 2.txt
`-- output/
    |-- 1.txt
    `-- 2.txt
```

## License

MIT
