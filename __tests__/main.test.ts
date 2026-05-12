import { describe, expect, it, vi, beforeEach } from "vitest";
import * as path from "path";

// vi.mock factories are hoisted, cannot reference outer variables
vi.mock("@actions/core", () => ({
	getInput: vi.fn(),
	getBooleanInput: vi.fn(),
	setOutput: vi.fn(),
	setFailed: vi.fn(),
	info: vi.fn(),
	notice: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	summary: {
		addRaw: vi.fn().mockReturnThis(),
		write: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("@actions/github", () => ({
	context: {
		payload: {},
		repo: { owner: "test-owner", repo: "test-repo" },
		sha: "abc123",
	},
	getOctokit: vi.fn(),
}));

// Import after mocks
import * as core from "@actions/core";
import { labelNewVsExisting, run } from "../src/main";
import type { FileResult, ParsedFailure } from "../src/types";

const FIXTURES = path.resolve(__dirname, "fixtures");

function failure(overrides: Partial<ParsedFailure> = {}): ParsedFailure {
	return {
		reason: "Cannot access refs during render",
		description: "Refs should only be accessed outside of render.",
		severity: "InvalidReact",
		suggestions: [],
		line: 10,
		fnName: "Component",
		...overrides,
	};
}

function result(failures: ParsedFailure[]): FileResult {
	return { file: "src/component.tsx", failures, skipped: [] };
}

function setupInputs(overrides: Record<string, string> = {}) {
	const defaults: Record<string, string> = {
		token: "fake-token",
		"annotation-level": "warning",
		"compilation-mode": "infer",
		"working-directory": FIXTURES,
		"include-patterns": "**/*.tsx\n**/*.ts",
		"exclude-patterns": "node_modules/**",
	};

	const merged = { ...defaults, ...overrides };

	vi.mocked(core.getInput).mockImplementation(
		(name: string) => merged[name] ?? "",
	);
	vi.mocked(core.getBooleanInput).mockImplementation((name: string) => {
		const val = merged[name];
		if (val === "true") return true;
		if (val === "false") return false;
		// Defaults
		if (name === "changed-files-only") return false;
		if (name === "fail-on-error") return false;
		if (name === "post-comment") return false;
		if (name === "annotations") return false;
		return false;
	});
}

describe("run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Re-setup summary mock after clear
		vi.mocked(core.summary.addRaw).mockReturnThis();
		vi.mocked(core.summary.write).mockResolvedValue(
			core.summary as unknown as typeof core.summary,
		);
	});

	it("sets outputs after a successful scan", async () => {
		setupInputs();
		await run();

		expect(core.setOutput).toHaveBeenCalledWith(
			"file-count",
			expect.any(String),
		);
		expect(core.setOutput).toHaveBeenCalledWith(
			"failure-count",
			expect.any(String),
		);
		expect(core.setOutput).toHaveBeenCalledWith(
			"has-failures",
			expect.any(String),
		);
		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("fails the step when fail-on-error is true and there are failures", async () => {
		setupInputs({ "fail-on-error": "true" });
		await run();

		// The fixtures include failing.tsx which has compiler errors
		expect(core.setFailed).toHaveBeenCalled();
	});

	it("does not fail when fail-on-error is false", async () => {
		setupInputs({ "fail-on-error": "false" });
		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("fails on invalid annotation-level", async () => {
		setupInputs({ "annotation-level": "invalid" });
		await run();

		expect(core.setFailed).toHaveBeenCalledWith(
			expect.stringContaining("Invalid annotation-level"),
		);
	});

	it("fails on invalid compilation-mode", async () => {
		setupInputs({ "compilation-mode": "invalid" });
		await run();

		expect(core.setFailed).toHaveBeenCalledWith(
			expect.stringContaining("Invalid compilation-mode"),
		);
	});

	it("sets file-count to 0 when no files match", async () => {
		setupInputs({
			"working-directory": FIXTURES,
			"include-patterns": "**/*.css",
		});
		await run();

		expect(core.setOutput).toHaveBeenCalledWith("file-count", "0");
		expect(core.setOutput).toHaveBeenCalledWith("failure-count", "0");
	});
});

describe("labelNewVsExisting", () => {
	it("matches existing failures across line shifts", () => {
		const head = result([failure({ line: 20 })]);
		const base = result([failure({ line: 10 })]);

		labelNewVsExisting(head, base);

		expect(head.failures[0].isNew).toBe(false);
	});

	it("treats extra repeated failures as new", () => {
		const head = result([
			failure({ line: 10 }),
			failure({ line: 20 }),
			failure({ line: 30 }),
		]);
		const base = result([failure({ line: 10 }), failure({ line: 20 })]);

		labelNewVsExisting(head, base);

		expect(head.failures.map((f) => f.isNew)).toEqual([false, false, true]);
	});

	it("matches repeated failures by closest line rather than head order", () => {
		const head = result([failure({ line: 5 }), failure({ line: 100 })]);
		const base = result([failure({ line: 90 })]);

		labelNewVsExisting(head, base);

		expect(head.failures.map((f) => f.isNew)).toEqual([true, false]);
	});

	it("breaks equal-distance matches by occurrence order", () => {
		const head = result([
			failure({ line: 10 }),
			failure({ line: 20 }),
			failure({ line: 30 }),
			failure({ line: 90 }),
		]);
		const base = result([
			failure({ line: 20 }),
			failure({ line: 30 }),
			failure({ line: 50 }),
		]);

		labelNewVsExisting(head, base);

		expect(head.failures.map((f) => f.isNew)).toEqual([
			true,
			false,
			false,
			false,
		]);
	});

	it("matches existing failures with anonymous components", () => {
		const head = result([failure({ fnName: undefined, line: 20 })]);
		const base = result([failure({ fnName: undefined, line: 10 })]);

		labelNewVsExisting(head, base);

		expect(head.failures[0].isNew).toBe(false);
	});

	it("does not match different compiler identities", () => {
		const head = result([failure({ reason: "Cannot mutate props" })]);
		const base = result([
			failure({ reason: "Cannot access refs during render" }),
		]);

		labelNewVsExisting(head, base);

		expect(head.failures[0].isNew).toBe(true);
	});

	it("identifies the genuinely new failure when an earlier insertion shifts existing ones", () => {
		// base [3, 5] → head [1, 4, 6]: a new failure at line 1, base shifted +1.
		// Correct labeling: head[0] is new, head[1] matches base[0], head[2] matches base[1].
		const head = result([
			failure({ line: 1 }),
			failure({ line: 4 }),
			failure({ line: 6 }),
		]);
		const base = result([failure({ line: 3 }), failure({ line: 5 })]);

		labelNewVsExisting(head, base);

		expect(head.failures.map((f) => f.isNew)).toEqual([true, false, false]);
	});

	it("marks every head failure as new when base has no failures", () => {
		const head = result([failure({ line: 10 }), failure({ line: 20 })]);
		const base = result([]);

		labelNewVsExisting(head, base);

		expect(head.failures.map((f) => f.isNew)).toEqual([true, true]);
	});
});
