import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";

export function getChangedFiles(baseRef: string, workingDir: string): string[] {
	try {
		const output = execFileSync(
			"git",
			["diff", "--name-only", "--diff-filter=ACMR", `origin/${baseRef}...HEAD`],
			{ cwd: workingDir, encoding: "utf-8", timeout: 30_000 },
		);
		return output
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean);
	} catch {
		try {
			const mergeBase = execFileSync(
				"git",
				["merge-base", "origin/HEAD", "HEAD"],
				{ cwd: workingDir, encoding: "utf-8", timeout: 10_000 },
			).trim();

			const output = execFileSync(
				"git",
				["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}...HEAD`],
				{ cwd: workingDir, encoding: "utf-8", timeout: 30_000 },
			);
			return output
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);
		} catch {
			return [];
		}
	}
}

function walkDir(dir: string): string[] {
	const results: string[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === ".next" ||
				entry.name === ".expo"
			) {
				continue;
			}
			results.push(...walkDir(fullPath));
		} else if (entry.isFile()) {
			results.push(fullPath);
		}
	}

	return results;
}

export function getAllFiles(workingDir: string): string[] {
	const absDir = path.resolve(workingDir);
	return walkDir(absDir).map((f) => path.relative(absDir, f));
}

export function isBaseRefReachable(
	baseRef: string,
	workingDir: string,
): boolean {
	try {
		execFileSync("git", ["rev-parse", "--verify", `origin/${baseRef}`], {
			cwd: workingDir,
			encoding: "utf-8",
			timeout: 5_000,
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

function fileExistsOnBase(
	baseRef: string,
	filePath: string,
	workingDir: string,
): boolean {
	try {
		execFileSync(
			"git",
			["cat-file", "-e", `origin/${baseRef}:${filePath}`],
			{ cwd: workingDir, encoding: "utf-8", timeout: 5_000, stdio: "pipe" },
		);
		return true;
	} catch {
		return false;
	}
}

export function getBaseFileContent(
	baseRef: string,
	filePath: string,
	workingDir: string,
): { exists: boolean; content: string | null } {
	if (!fileExistsOnBase(baseRef, filePath, workingDir)) {
		return { exists: false, content: null };
	}

	try {
		const content = execFileSync(
			"git",
			["show", `origin/${baseRef}:${filePath}`],
			{ cwd: workingDir, encoding: "utf-8", timeout: 10_000 },
		);
		return { exists: true, content };
	} catch {
		return { exists: true, content: null };
	}
}

export function filterFiles(
	files: string[],
	includePatterns: string[],
	excludePatterns: string[],
): string[] {
	const isIncluded = picomatch(includePatterns, { dot: false });
	const isExcluded = picomatch(excludePatterns, { dot: false });

	return files.filter((file) => {
		if (isExcluded(file)) return false;
		return isIncluded(file);
	});
}
