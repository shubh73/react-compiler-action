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
import { run } from "../src/main";

const FIXTURES = path.resolve(__dirname, "fixtures");

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
