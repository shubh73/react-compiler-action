import { describe, expect, it } from "vitest";
import { buildReport } from "../src/reporter";
import type { FileResult } from "../src/types";

describe("buildReport", () => {
  it("returns null when there are no failures or errors", () => {
    const results: FileResult[] = [
      { file: "good.tsx", failures: [], skipped: [] },
    ];

    expect(buildReport(results, undefined, undefined)).toBeNull();
  });

  it("builds a report with failure table", () => {
    const results: FileResult[] = [
      {
        file: "src/bad.tsx",
        failures: [
          {
            reason: "Mutating a variable",
            description: "Cannot mutate",
            severity: "InvalidReact",
            suggestions: [],
            line: 3,
            fnName: "BadComponent",
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).not.toBeNull();
    expect(report).toContain("React Compiler Optimization Report");
    expect(report).toContain("BadComponent");
    expect(report).toContain("Mutating a variable");
    expect(report).toContain("`src/bad.tsx`");
  });

  it("includes clickable links when repo info is provided", () => {
    const results: FileResult[] = [
      {
        file: "src/bad.tsx",
        failures: [
          {
            reason: "Mutating a variable",
            description: "",
            severity: "",
            suggestions: [],
            line: 10,
            fnName: "Broken",
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, "my-org/my-repo", "abc123");

    expect(report).toContain(
      "https://github.com/my-org/my-repo/blob/abc123/src/bad.tsx#L10"
    );
  });

  it("includes 'use no memo' opt-outs in a collapsible section", () => {
    const results: FileResult[] = [
      {
        file: "src/hook.tsx",
        failures: [],
        skipped: [
          { fnName: "useCustomHook", line: 5, reason: "use no memo" },
        ],
      },
      {
        file: "src/bad.tsx",
        failures: [
          {
            reason: "Some error",
            description: "",
            severity: "",
            suggestions: [],
            line: 1,
            fnName: "Bad",
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).toContain("use no memo");
    expect(report).toContain("useCustomHook");
  });

  it("includes the 'Fix with AI' section", () => {
    const results: FileResult[] = [
      {
        file: "src/comp.tsx",
        failures: [
          {
            reason: "Some error",
            description: "Detailed explanation",
            severity: "",
            suggestions: ["Try this fix"],
            line: 5,
            fnName: "MyComp",
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).toContain("Fix with AI");
    expect(report).toContain("Detailed explanation");
    expect(report).toContain("Try this fix");
  });

  it("splits new vs existing when isNew is set", () => {
    const results: FileResult[] = [
      {
        file: "src/comp.tsx",
        failures: [
          {
            reason: "New issue",
            description: "",
            severity: "",
            suggestions: [],
            line: 5,
            fnName: "NewComp",
            isNew: true,
          },
          {
            reason: "Old issue",
            description: "",
            severity: "",
            suggestions: [],
            line: 10,
            fnName: "OldComp",
            isNew: false,
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).not.toBeNull();
    expect(report).toContain("**1** new issue introduced in this PR");
    expect(report).toContain("1 existing issue in changed files");
    expect(report).toContain("### New (introduced in this PR)");
    expect(report).toContain("Existing issues (1)");
    expect(report).toContain("NewComp");
    expect(report).toContain("OldComp");
  });

  it("collapses existing issues in a details element", () => {
    const results: FileResult[] = [
      {
        file: "src/comp.tsx",
        failures: [
          {
            reason: "Old issue",
            description: "",
            severity: "",
            suggestions: [],
            line: 10,
            fnName: "OldComp",
            isNew: false,
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).not.toBeNull();
    expect(report).toContain("<details>");
    expect(report).toContain("Existing issues (1)");
  });

  it("uses single-table format when isNew is undefined (full-scan)", () => {
    const results: FileResult[] = [
      {
        file: "src/comp.tsx",
        failures: [
          {
            reason: "Some error",
            description: "",
            severity: "",
            suggestions: [],
            line: 5,
            fnName: "Comp",
          },
        ],
        skipped: [],
      },
    ];

    const report = buildReport(results, undefined, undefined);

    expect(report).not.toBeNull();
    expect(report).not.toContain("New (introduced");
    expect(report).not.toContain("Existing issues");
    expect(report).toContain("Comp");
  });
});
