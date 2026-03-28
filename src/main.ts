import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";

import { checkCode, checkFile } from "./checker";
import { upsertComment } from "./comment";
import {
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

function labelNewVsExisting(
	headResult: FileResult,
	baseResult: FileResult,
): void {
	for (const failure of headResult.failures) {
		const existsOnBase = baseResult.failures.some(
			(base) => base.fnName === failure.fnName && base.reason === failure.reason,
		);
		failure.isNew = !existsOnBase;
	}
}

export async function run(): Promise<void> {
	try {
		const inputs = parseInputs();
		const workingDir = path.resolve(inputs.workingDirectory);

		detectCompilerVersionMismatch(workingDir);

		let files: string[];
		const prNumber = github.context.payload.pull_request?.number;
		const baseRef = github.context.payload.pull_request?.base?.ref;

		if (inputs.changedFilesOnly && baseRef) {
			core.info(`Checking files changed against ${baseRef}...`);
			files = getChangedFiles(baseRef, workingDir);
		} else {
			if (inputs.changedFilesOnly && !baseRef) {
				core.info(
					"No base ref found (not a PR event?). Falling back to full scan.",
				);
			}
			core.info("Scanning all files...");
			files = getAllFiles(workingDir);
		}

		files = filterFiles(files, inputs.includePatterns, inputs.excludePatterns);
		files = files.filter((f) => {
			const fullPath = path.resolve(workingDir, f);
			return fs.existsSync(fullPath);
		});

		if (files.length === 0) {
			core.info("No matching files to check.");

			if (inputs.postComment && prNumber) {
				await upsertComment(inputs.token, prNumber, null);
			}

			core.setOutput("failure-count", "0");
			core.setOutput("new-failure-count", "0");
			core.setOutput("existing-failure-count", "0");
			core.setOutput("file-count", "0");
			core.setOutput("has-failures", "false");
			core.setOutput("report", "");
			core.setOutput("comment-id", "");
			return;
		}

		core.info(
			`Checking ${files.length} file(s) with compilation mode "${inputs.compilationMode}"...`,
		);

		const results = files.map((f) => {
			const fullPath = path.resolve(workingDir, f);
			return checkFile(fullPath, inputs.compilationMode);
		});

		for (const result of results) {
			result.file = path.relative(workingDir, result.file);
		}

		let hasPrComparison = inputs.changedFilesOnly && !!baseRef;
		if (hasPrComparison && !isBaseRefReachable(baseRef!, workingDir)) {
			core.warning(
				`origin/${baseRef} is not reachable. Skipping new-vs-existing comparison. ` +
					"Ensure fetch-depth: 0 in your checkout step.",
			);
			hasPrComparison = false;
		}

		if (hasPrComparison) {
			for (const result of results) {
				if (result.failures.length === 0) continue;

				const base = getBaseFileContent(baseRef!, result.file, workingDir);

				if (!base.exists) {
					for (const f of result.failures) f.isNew = true;
				} else if (base.content === null) {
					core.warning(
						`Could not read base version of ${result.file}. ` +
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
		const commitSha = github.context.sha;
		const report = buildReport(results, repoSlug, commitSha);

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
		} else {
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
