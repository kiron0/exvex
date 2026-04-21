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
- Customize compiler commands and defaults with `exvex.config.json`
- Prompt interactively when launched in a TTY without arguments

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

When you run `exvex` with no arguments in an interactive terminal, it prompts for the mode and required files.

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
```

All long options support both forms: `--option=value` and `--option value`.

To pass a positional filename that starts with `-`, stop option parsing first:

```bash
exvex -- --help
exvex test -- --main.py
exvex stress -- --solution.py --brute.py --gen.py
```

On the first mismatch or runtime failure, exvex writes the failing input and both outputs to `.exvex/stress/`.

### Options at a glance

- `--input FILE` or `--input=FILE`: read stdin from file in run mode
- `--input-dir DIR` or `--input-dir=DIR`: override judge input directory
- `--output-dir DIR` or `--output-dir=DIR`: override judge output directory
- `--iterations N` or `--iterations=N`: set stress-test iteration count, default `100`
- `--timeout MS` or `--timeout=MS`: set timeout in milliseconds, default `2000`
- `--timeout 0`: disable timeout entirely
- `--no-cache`: bypass compile cache for current invocation
- `--help` or `-h`: print help
- `--`: stop option parsing so later arguments are treated as positional filenames

## Behavior Notes

- Compiled artifacts are cached under `.exvex/cache/` by default for C, C++, Java, Go, Rust, and Kotlin
- `--no-cache` uses temporary build artifacts instead of reusing cached ones
- Judge mode defaults to `input/` and `output/` directories unless overridden in config or CLI flags
- Output comparison normalizes line endings and ignores trailing whitespace at end of output
- Stress failures write `failing-input.txt`, `solution-output.txt`, and `brute-output.txt` under `.exvex/stress/`
- Extensionless files work when exvex can detect language from a shebang or recognizable source pattern

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
  "outputDir": "output"
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
