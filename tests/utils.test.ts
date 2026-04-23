import { describe, expect, it } from "vitest";
import { describeExitCode } from "../src/utils";

describe("describeExitCode", () => {
  it("explains known Windows crash codes", () => {
    expect(describeExitCode(3221225477)).toBe("access violation");
  });

  it("leaves unknown exit codes unchanged", () => {
    expect(describeExitCode(1)).toBe("exit code 1");
    expect(describeExitCode(null)).toBe("unknown exit");
  });
});
