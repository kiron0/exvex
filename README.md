# exvex

[![npm version](https://img.shields.io/npm/v/exvex.svg?style=flat-square)](https://www.npmjs.com/package/exvex)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

**exvex is a fast CLI runner and local judge for competitive programming workflows.**

It detects supported languages, compiles when needed, runs sample tests, and supports brute-force stress testing from the terminal.

## Features

- Run supported source files with one command
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

## Sample Directory Layout

```text
problem/
├── main.cpp
├── input/
│   ├── 1.txt
│   └── 2.txt
└── output/
    ├── 1.txt
    └── 2.txt
```

## License

MIT
