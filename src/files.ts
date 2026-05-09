import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";

export type ChangedFile = {
	path: string;
	basePath: string;
};

export type ChangedFilesResult =
	| { ok: true; files: ChangedFile[] }
	| { ok: false; reason: string };

function parseNameStatus(output: string): ChangedFile[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [status, firstPath, secondPath] = line.split("\t");
			if (status.startsWith("R") && secondPath) {
				return { path: secondPath, basePath: firstPath };
			}
			if (status.startsWith("C") && secondPath) {
				return { path: secondPath, basePath: secondPath };
			}
			return { path: firstPath, basePath: firstPath };
		})
		.filter((file) => file.path);
}

function formatGitError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function getChangedFiles(
	baseRef: string,
	workingDir: string,
): ChangedFilesResult {
	try {
		const output = execFileSync(
			"git",
			[
				"diff",
				"--name-status",
				"--find-renames",
				"--diff-filter=ACMR",
				`origin/${baseRef}...HEAD`,
			],
			{ cwd: workingDir, encoding: "utf-8", timeout: 30_000 },
		);
		return { ok: true, files: parseNameStatus(output) };
	} catch (firstError) {
		try {
			const mergeBase = execFileSync(
				"git",
				["merge-base", "origin/HEAD", "HEAD"],
				{ cwd: workingDir, encoding: "utf-8", timeout: 10_000 },
			).trim();

			const output = execFileSync(
				"git",
				[
					"diff",
					"--name-status",
					"--find-renames",
					"--diff-filter=ACMR",
					`${mergeBase}...HEAD`,
				],
				{ cwd: workingDir, encoding: "utf-8", timeout: 30_000 },
			);
			return { ok: true, files: parseNameStatus(output) };
		} catch (secondError) {
			return {
				ok: false,
				reason:
					`Could not determine changed files. Primary diff failed: ${formatGitError(firstError)}. ` +
					`Fallback diff failed: ${formatGitError(secondError)}.`,
			};
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
