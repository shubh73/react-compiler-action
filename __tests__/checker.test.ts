import { describe, expect, it } from "vitest";
import * as path from "path";
import {
  checkCode,
  checkFile,
  dedupeFailures,
  parseCompileDiagnostic,
  parseCompileError,
} from "../src/checker";
import type { CompileDiagnosticEvent, CompileErrorEvent } from "../src/types";
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

  it("uses precise compiler detail locations when available", () => {
    const result = checkCode(
      `
import { useRef } from "react";

export function RefAccess() {
  const firstRef = useRef(0);
  const secondRef = useRef(0);
  firstRef.current = 1;
  secondRef.current = 2;
  return <div />;
}
      `,
      "ref-access.tsx",
      "infer"
    );

    expect(result.error).toBeUndefined();
    expect(result.failures.map((failure) => failure.line)).toEqual([7, 8]);
  });

  it("skips hint details and null-loc entries when reading precise location", () => {
    const event: CompileErrorEvent = {
      kind: "CompileError",
      fnLoc: { start: { line: 1, column: 0 } },
      detail: {
        reason: "Cannot mutate props",
        description: "",
        severity: "InvalidReact",
        options: {
          reason: "Cannot mutate props",
          severity: "InvalidReact",
          details: [
            { kind: "hint", message: "Try moving this to an effect." },
            { kind: "error", loc: null },
            { kind: "error", loc: { start: { line: 9, column: 0 } } },
          ],
        },
      },
    };

    const failure = parseCompileError(event, ["", "", "", "", "", "", "", "", ""]);
    expect(failure.line).toBe(9);
  });

  it("falls back to detail.loc when no diagnostic details array is present", () => {
    // Real CompilerErrorDetail instances expose loc via getter; we model that here.
    const event: CompileErrorEvent = {
      kind: "CompileError",
      fnLoc: { start: { line: 1, column: 0 } },
      detail: {
        reason: "Cannot mutate props",
        description: "",
        severity: "InvalidReact",
        loc: { start: { line: 4, column: 0 } },
      },
    };

    const failure = parseCompileError(event, ["", "", "", "", ""]);
    expect(failure.line).toBe(4);
  });

  it("falls back to event.fnLoc when no detail location is present", () => {
    const event: CompileErrorEvent = {
      kind: "CompileError",
      fnLoc: { start: { line: 3, column: 0 } },
      detail: {
        reason: "Cannot mutate props",
        description: "",
        severity: "InvalidReact",
        options: { reason: "Cannot mutate props", severity: "InvalidReact" },
      },
    };

    const failure = parseCompileError(event, ["", "", ""]);
    expect(failure.line).toBe(3);
  });

  it("parses compiler diagnostics as failures", () => {
    const event: CompileDiagnosticEvent = {
      kind: "CompileDiagnostic",
      fnLoc: { start: { line: 3, column: 0 } },
      detail: {
        category: "Todo",
        reason: "JSX Inlining is not supported on value blocks",
        description: "Unsupported JSX inlining case.",
        loc: { start: { line: 8, column: 0 } },
      },
    };

    const failure = parseCompileDiagnostic(event, [
      "",
      "",
      "export function Component() {",
      "  return null;",
      "}",
    ]);

    expect(failure).toMatchObject({
      line: 8,
      fnName: "Component",
      reason: "JSX Inlining is not supported on value blocks",
      description: "Unsupported JSX inlining case.",
      severity: "Todo",
    });
  });

  it("dedupes identical compiler failures", () => {
    const duplicate = {
      reason: "Cannot access refs during render",
      description: "Refs should only be accessed outside of render.",
      severity: "InvalidReact",
      suggestions: [],
      line: 42,
      fnName: "Broken",
    };

    const failures = dedupeFailures([
      duplicate,
      { ...duplicate },
      { ...duplicate, line: 43 },
    ]);

    expect(failures).toHaveLength(2);
    expect(failures[0]).toBe(duplicate);
  });
});
