import { describe, expect, it } from "vitest";
import { splitCommand } from "../src/utils";

describe("splitCommand cross-platform behavior", () => {
  it("throws when command contains an unmatched quote", () => {
    expect(() => splitCommand('node -e "console.log(1)')).toThrow(
      "Invalid command: unmatched",
    );
  });

  it.each([
    {
      name: "parses quoted arguments with spaces",
      input: 'python3 -c "print(\\"hello world\\")"',
      expected: ["python3", "-c", 'print("hello world")'],
    },
    {
      name: "parses escaped spaces in unquoted tokens",
      input: "my\\ command --flag",
      expected: ["my command", "--flag"],
    },
    {
      name: "preserves plain Windows path token",
      input: "C:\\Tools\\python.exe -V",
      expected: ["C:\\Tools\\python.exe", "-V"],
    },
    {
      name: "preserves quoted Windows path with spaces",
      input: '"C:\\Program Files\\Python\\python.exe" -V',
      expected: ["C:\\Program Files\\Python\\python.exe", "-V"],
    },
    {
      name: "preserves unquoted Windows executable path with spaces",
      input: "C:\\Program Files\\nodejs\\node.exe C:\\tmp\\tool.js --flag",
      expected: [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\tmp\\tool.js",
        "--flag",
      ],
    },
    {
      name: "preserves unquoted extensionless Windows tool path with spaces",
      input: "C:\\Program Files\\LLVM\\bin\\clang++ -O2",
      expected: ["C:\\Program Files\\LLVM\\bin\\clang++", "-O2"],
    },
    {
      name: "parses escaped spaces in Windows path",
      input: "C:\\Program\\ Files\\Python\\python.exe -V",
      expected: ["C:\\Program Files\\Python\\python.exe", "-V"],
    },
    {
      name: "preserves UNC path token",
      input: "\\\\server\\tools\\python.exe -V",
      expected: ["\\\\server\\tools\\python.exe", "-V"],
    },
    {
      name: "preserves quoted UNC path",
      input: '"\\\\server\\tools\\python.exe" -V',
      expected: ["\\\\server\\tools\\python.exe", "-V"],
    },
    {
      name: "supports mixed quoted args and escaped spaces",
      input:
        '"C:\\Program Files\\Python\\python.exe" -c "print(\\"hello world\\")" --name=my\\ value',
      expected: [
        "C:\\Program Files\\Python\\python.exe",
        "-c",
        'print("hello world")',
        "--name=my value",
      ],
    },
  ])("$name", ({ input, expected }) => {
    expect(splitCommand(input)).toEqual(expected);
  });
});
