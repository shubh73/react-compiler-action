import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";

import { checkCode, checkFile } from "./checker";
import { upsertComment } from "./comment";
import {
	type ChangedFile,
	filterFiles,
	getAllFiles,
	getBaseFileContent,
	getChangedFiles,
	isBaseRefReachable,
} from "./files";
import { buildReport, emitAnnotations } from "./reporter";
import type {
	ActionInputs,
	AnnotationLevel,
	CompilationMode,
	FileResult,
	ParsedFailure,
} from "./types";

function parseInputs(): ActionInputs {
	const annotationLevel = core.getInput("annotation-level") as AnnotationLevel;
	if (!["warning", "error", "notice"].includes(annotationLevel)) {
		throw new Error(
			`Invalid annotation-level: "${annotationLevel}". Must be warning, error, or notice.`,
		);
	}

	const compilationMode = core.getInput("compilation-mode") as CompilationMode;
	if (!["infer", "all", "annotation"].includes(compilationMode)) {
		throw new Error(
			`Invalid compilation-mode: "${compilationMode}". Must be infer, all, or annotation.`,
		);
	}

	const parsePatterns = (input: string): string[] =>
		input
			.split("\n")
			.map((p) => p.trim())
			.filter(Boolean);

	return {
		token: core.getInput("token", { required: true }),
		changedFilesOnly: core.getBooleanInput("changed-files-only"),
		failOnError: core.getBooleanInput("fail-on-error"),
		postComment: core.getBooleanInput("post-comment"),
		annotations: core.getBooleanInput("annotations"),
		annotationLevel,
		compilationMode,
		workingDirectory: core.getInput("working-directory") || ".",
		includePatterns: parsePatterns(core.getInput("include-patterns")),
		excludePatterns: parsePatterns(core.getInput("exclude-patterns")),
	};
}

function toChangedFiles(files: string[]): ChangedFile[] {
	return files.map((file) => ({ path: file, basePath: file }));
}

function detectCompilerVersionMismatch(workingDir: string): void {
	try {
		const bundledPkg = require("babel-plugin-react-compiler/package.json");
		const localPath = path.join(
			workingDir,
			"node_modules/babel-plugin-react-compiler/package.json",
		);

		if (fs.existsSync(localPath)) {
			const localPkg = JSON.parse(fs.readFileSync(localPath, "utf-8"));
			if (localPkg.version !== bundledPkg.version) {
				core.notice(
					`Action bundles babel-plugin-react-compiler@${bundledPkg.version}, ` +
						`but your project uses v${localPkg.version}. Results may differ slightly.`,
					{ title: "React Compiler Version Mismatch" },
				);
			}
		}
	} catch {}
}

function failureIdentity(failure: ParsedFailure): string {
	return JSON.stringify([
		failure.fnName ?? "",
		failure.severity,
		failure.reason,
		failure.description,
	]);
}

// Order-preserving assignment of head failures to base failures, maximizing the
// number of matched pairs and minimizing the total line drift among matches.
// A greedy "closest-pair-first" walk produces wrong answers when an early local
// optimum blocks a globally better assignment (e.g. base=[3,5], head=[1,4,6]).
function matchExistingFailures(
	headFailures: ParsedFailure[],
	baseFailures: ParsedFailure[],
): Set<number> {
	const sortedHead = headFailures
		.map((f, originalIndex) => ({ line: f.line, originalIndex }))
		.sort((a, b) => a.line - b.line);
	const sortedBase = baseFailures
		.map((f) => f.line)
		.sort((a, b) => a - b);

	const H = sortedHead.length;
	const B = sortedBase.length;
	const matches: number[][] = Array.from({ length: H + 1 }, () =>
		new Array(B + 1).fill(0),
	);
	const cost: number[][] = Array.from({ length: H + 1 }, () =>
		new Array(B + 1).fill(0),
	);

	for (let i = 1; i <= H; i++) {
		for (let j = 1; j <= B; j++) {
			const matchM = matches[i - 1][j - 1] + 1;
			const matchC =
				cost[i - 1][j - 1] + Math.abs(sortedHead[i - 1].line - sortedBase[j - 1]);
			let bestM = matches[i - 1][j];
			let bestC = cost[i - 1][j];
			if (
				matches[i][j - 1] > bestM ||
				(matches[i][j - 1] === bestM && cost[i][j - 1] < bestC)
			) {
				bestM = matches[i][j - 1];
				bestC = cost[i][j - 1];
			}
			if (matchM > bestM || (matchM === bestM && matchC < bestC)) {
				bestM = matchM;
				bestC = matchC;
			}
			matches[i][j] = bestM;
			cost[i][j] = bestC;
		}
	}

	const matched = new Set<number>();
	let i = H;
	let j = B;
	while (i > 0 && j > 0) {
		const matchC =
			cost[i - 1][j - 1] + Math.abs(sortedHead[i - 1].line - sortedBase[j - 1]);
		if (
			matches[i][j] === matches[i - 1][j - 1] + 1 &&
			cost[i][j] === matchC
		) {
			matched.add(sortedHead[i - 1].originalIndex);
			i--;
			j--;
		} else if (
			matches[i][j] === matches[i - 1][j] &&
			cost[i][j] === cost[i - 1][j]
		) {
			i--;
		} else {
			j--;
		}
	}
	return matched;
}

export function labelNewVsExisting(
	headResult: FileResult,
	baseResult: FileResult,
): void {
	const baseFailuresByIdentity = new Map<string, ParsedFailure[]>();
	for (const failure of baseResult.failures) {
		const key = failureIdentity(failure);
		const failures = baseFailuresByIdentity.get(key) ?? [];
		failures.push(failure);
		baseFailuresByIdentity.set(key, failures);
	}

	const headFailuresByIdentity = new Map<string, ParsedFailure[]>();
	for (const failure of headResult.failures) {
		const key = failureIdentity(failure);
		const failures = headFailuresByIdentity.get(key) ?? [];
		failures.push(failure);
		headFailuresByIdentity.set(key, failures);
	}

	for (const [key, headFailures] of headFailuresByIdentity) {
		const matchedIndexes = matchExistingFailures(
			headFailures,
			baseFailuresByIdentity.get(key) ?? [],
		);

		headFailures.forEach((failure, index) => {
			failure.isNew = !matchedIndexes.has(index);
		});
	}
}

export async function run(): Promise<void> {
	try {
		const inputs = parseInputs();
		const workingDir = path.resolve(inputs.workingDirectory);

		detectCompilerVersionMismatch(workingDir);

		const reportNotes: string[] = [];
		const prNumber = github.context.payload.pull_request?.number;
		const baseRef = github.context.payload.pull_request?.base?.ref;
		let hasPrComparison = inputs.changedFilesOnly && !!baseRef;

		let files: ChangedFile[];
		if (inputs.changedFilesOnly && baseRef) {
			core.info(`Checking files changed against ${baseRef}...`);
			const changedFiles = getChangedFiles(baseRef, workingDir);
			if (changedFiles.ok) {
				files = changedFiles.files;
			} else {
				hasPrComparison = false;
				core.warning(
					`${changedFiles.reason} Falling back to a full scan without new-vs-existing comparison.`,
				);
				reportNotes.push(
					"Changed-file detection failed, so this report uses a full scan and does not classify issues as new vs. existing.",
				);
				files = toChangedFiles(getAllFiles(workingDir));
			}
		} else {
			if (inputs.changedFilesOnly && !baseRef) {
				core.info(
					"No base ref found (not a PR event?). Falling back to full scan.",
				);
			}
			core.info("Scanning all files...");
			files = toChangedFiles(getAllFiles(workingDir));
		}

		const filteredPaths = new Set(
			filterFiles(
				files.map((file) => file.path),
				inputs.includePatterns,
				inputs.excludePatterns,
			),
		);
		files = files.filter((file) => filteredPaths.has(file.path));
		files = files.filter((f) => {
			const fullPath = path.resolve(workingDir, f.path);
			return fs.existsSync(fullPath);
		});

		if (files.length === 0) {
			core.info("No matching files to check.");
		} else {
			core.info(
				`Checking ${files.length} file(s) with compilation mode "${inputs.compilationMode}"...`,
			);
		}

		const results = files.map((f) => {
			const fullPath = path.resolve(workingDir, f.path);
			return checkFile(fullPath, inputs.compilationMode);
		});

		for (const result of results) {
			result.file = path
				.relative(workingDir, result.file)
				.split(path.sep)
				.join("/");
		}

		const basePathByFile = new Map(
			files.map((file) => [file.path, file.basePath]),
		);
		if (hasPrComparison && !isBaseRefReachable(baseRef!, workingDir)) {
			core.warning(
				`origin/${baseRef} is not reachable. Skipping new-vs-existing comparison. ` +
					"Ensure fetch-depth: 0 in your checkout step.",
			);
			reportNotes.push(
				`origin/${baseRef} was not reachable, so issues are not classified as new vs. existing. Ensure fetch-depth: 0 in your checkout step.`,
			);
			hasPrComparison = false;
		}

		if (hasPrComparison) {
			for (const result of results) {
				if (result.failures.length === 0) continue;

				const basePath = basePathByFile.get(result.file) ?? result.file;
				const base = getBaseFileContent(baseRef!, basePath, workingDir);

				if (!base.exists) {
					for (const f of result.failures) f.isNew = true;
				} else if (base.content === null) {
					core.warning(
						`Could not read base version of ${basePath}. ` +
							"Skipping new-vs-existing comparison for this file.",
					);
				} else {
					const baseResult = checkCode(
						base.content,
						path.resolve(workingDir, result.file),
						inputs.compilationMode,
					);
					labelNewVsExisting(result, baseResult);
				}
			}
		}

		const totalFailures = results.reduce((n, r) => n + r.failures.length, 0);
		const newFailures = results.reduce(
			(n, r) => n + r.failures.filter((f) => f.isNew === true).length,
			0,
		);
		const existingFailures = results.reduce(
			(n, r) => n + r.failures.filter((f) => f.isNew === false).length,
			0,
		);

		if (inputs.annotations && totalFailures > 0) {
			emitAnnotations(results, inputs.annotationLevel);
		}

		const repoSlug = process.env.GITHUB_REPOSITORY;
		const commitSha =
			github.context.payload.pull_request?.head?.sha ?? github.context.sha;
		const report = buildReport(results, repoSlug, commitSha, reportNotes);

		let commentId: number | null = null;
		if (inputs.postComment && prNumber) {
			commentId = await upsertComment(inputs.token, prNumber, report);
		}

		if (report) {
			await core.summary.addRaw(report).write();
		}

		core.setOutput("failure-count", String(totalFailures));
		core.setOutput("new-failure-count", String(newFailures));
		core.setOutput("existing-failure-count", String(existingFailures));
		core.setOutput("file-count", String(files.length));
		core.setOutput("has-failures", totalFailures > 0 ? "true" : "false");
		core.setOutput("report", report ?? "");
		core.setOutput("comment-id", commentId ? String(commentId) : "");

		if (totalFailures > 0) {
			if (hasPrComparison) {
				core.info(
					`${newFailures} new + ${existingFailures} existing issue(s) found.`,
				);
			} else {
				core.info(
					`${totalFailures} component(s) not optimized by React Compiler.`,
				);
			}
		} else if (files.length > 0) {
			core.info(
				`All ${files.length} file(s) passed. React Compiler can memoize every component.`,
			);
		}

		if (inputs.failOnError) {
			const failCount = hasPrComparison ? newFailures : totalFailures;
			if (failCount > 0) {
				core.setFailed(
					hasPrComparison
						? `${newFailures} new issue(s) introduced in this PR.`
						: `${totalFailures} component(s) skipped by React Compiler.`,
				);
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		} else {
			core.setFailed("An unexpected error occurred");
		}
	}
}
