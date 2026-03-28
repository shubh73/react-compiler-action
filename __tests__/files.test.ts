import { describe, expect, it } from "vitest";
import { filterFiles } from "../src/files";

describe("filterFiles", () => {
	it("includes files matching include patterns", () => {
		const files = ["src/App.tsx", "src/utils.ts", "README.md", "package.json"];
		const result = filterFiles(files, ["**/*.ts", "**/*.tsx"], []);

		expect(result).toEqual(["src/App.tsx", "src/utils.ts"]);
	});

	it("excludes files matching exclude patterns", () => {
		const files = [
			"src/App.tsx",
			"node_modules/react/index.js",
			"dist/bundle.js",
		];
		const result = filterFiles(
			files,
			["**/*.tsx", "**/*.js"],
			["node_modules/**", "dist/**"],
		);

		expect(result).toEqual(["src/App.tsx"]);
	});

	it("exclude takes precedence over include", () => {
		const files = ["src/App.test.tsx", "src/App.tsx"];
		const result = filterFiles(files, ["**/*.tsx"], ["**/*.test.*"]);

		expect(result).toEqual(["src/App.tsx"]);
	});

	it("returns empty array when no files match", () => {
		const files = ["README.md", "package.json"];
		const result = filterFiles(files, ["**/*.tsx"], []);

		expect(result).toEqual([]);
	});

	it("handles multiple include patterns", () => {
		const files = ["a.ts", "b.tsx", "c.js", "d.jsx", "e.css"];
		const result = filterFiles(
			files,
			["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
			[],
		);

		expect(result).toEqual(["a.ts", "b.tsx", "c.js", "d.jsx"]);
	});

	it("excludes .d.ts files", () => {
		const files = ["src/types.d.ts", "src/App.tsx"];
		const result = filterFiles(files, ["**/*.ts", "**/*.tsx"], ["**/*.d.ts"]);

		expect(result).toEqual(["src/App.tsx"]);
	});
});
