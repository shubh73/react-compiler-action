import { describe, expect, it } from "vitest";
import * as path from "path";
import { checkCode, checkFile } from "../src/checker";
import * as fs from "fs";

const FIXTURES = path.resolve(__dirname, "fixtures");

describe("checkFile", () => {
  it("reports no failures for valid components", () => {
    const result = checkFile(path.join(FIXTURES, "passing.tsx"), "infer");

    expect(result.error).toBeUndefined();
    expect(result.failures).toHaveLength(0);
  });

  it("reports failures for components that mutate props", () => {
    const result = checkFile(path.join(FIXTURES, "failing.tsx"), "infer");

    expect(result.error).toBeUndefined();
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].fnName).toBe("ConditionalHook");
  });

  it("separates 'use no memo' opt-outs from failures", () => {
    const result = checkFile(path.join(FIXTURES, "opted-out.tsx"), "infer");

    expect(result.error).toBeUndefined();
    // Should not appear as a failure
    expect(result.failures).toHaveLength(0);
    // Should appear as skipped
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped[0].reason).toBe("use no memo");
  });

  it("handles non-existent files gracefully", () => {
    const result = checkFile("/does/not/exist.tsx", "infer");

    expect(result.error).toBeDefined();
    expect(result.failures).toHaveLength(0);
  });

  it("handles non-React files without errors", () => {
    const result = checkFile(
      path.join(FIXTURES, "..", "checker.test.ts"),
      "infer"
    );

    expect(result.error).toBeUndefined();
    expect(result.failures).toHaveLength(0);
  });
});

describe("checkCode", () => {
  it("produces same results as checkFile for identical content", () => {
    const filePath = path.join(FIXTURES, "failing.tsx");
    const code = fs.readFileSync(filePath, "utf-8");

    const fileResult = checkFile(filePath, "infer");
    const codeResult = checkCode(code, filePath, "infer");

    expect(codeResult.failures.length).toBe(fileResult.failures.length);
    expect(codeResult.skipped.length).toBe(fileResult.skipped.length);
    expect(codeResult.error).toBe(fileResult.error);

    for (let i = 0; i < codeResult.failures.length; i++) {
      expect(codeResult.failures[i].fnName).toBe(fileResult.failures[i].fnName);
      expect(codeResult.failures[i].reason).toBe(fileResult.failures[i].reason);
    }
  });

  it("returns parse error for invalid code", () => {
    const result = checkCode("export function {{{", "bad.tsx", "infer");

    expect(result.error).toBeDefined();
    expect(result.failures).toHaveLength(0);
  });
});
