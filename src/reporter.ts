import * as core from "@actions/core";

import type { AnnotationLevel, FileResult, ParsedFailure } from "./types";

const MAX_ANNOTATION_MESSAGE_LENGTH = 150;

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 3) + "...";
}

export function emitAnnotations(
	results: FileResult[],
	level: AnnotationLevel,
	maxAnnotations: number = 50,
): void {
	let count = 0;

	for (const result of results) {
		for (const failure of result.failures) {
			if (count >= maxAnnotations) return;
			if (failure.isNew === false) continue;

			const name = failure.fnName ? `"${failure.fnName}"` : "A component";
			const prefix = failure.isNew === true ? "[New] " : "";
			const fullMessage =
				failure.description && failure.description !== failure.reason
					? `${prefix}${name} skipped: ${failure.reason}: ${failure.description}`
					: `${prefix}${name} skipped: ${failure.reason}`;

			const message = truncate(fullMessage, MAX_ANNOTATION_MESSAGE_LENGTH);
			const properties = {
				file: result.file,
				startLine: failure.line,
				title: "React Compiler",
			};

			switch (level) {
				case "error":
					core.error(message, properties);
					break;
				case "notice":
					core.notice(message, properties);
					break;
				default:
					core.warning(message, properties);
			}

			count++;
		}
	}
}

function stripUrls(reason: string): string {
	return reason
		.replace(/\s*\(?https?:\/\/[^\s)]+\)?\s*/g, " ")
		.replace(/\s*See the Rules of Hooks\s*/g, "")
		.trim();
}

function formatFailureRow(
	file: string,
	failure: ParsedFailure,
	repoSlug: string | undefined,
	commitSha: string | undefined,
): string {
	const name = failure.fnName ?? "(anonymous)";

	const fileLink =
		repoSlug && commitSha
			? `[\`${file}:${failure.line}\`](https://github.com/${repoSlug}/blob/${commitSha}/${file}#L${failure.line})`
			: `\`${file}:${failure.line}\``;

	const reason = stripUrls(failure.reason);
	const reasonText = failure.severity
		? `\`${failure.severity}\` ${reason}`
		: reason;

	return `| ${fileLink} | \`${name}\` | ${reasonText} |`;
}

export function buildReport(
	results: FileResult[],
	repoSlug: string | undefined,
	commitSha: string | undefined,
): string | null {
	const filesWithFailures = results.filter((r) => r.failures.length > 0);
	const filesWithErrors = results.filter((r) => r.error);
	const totalFailures = filesWithFailures.reduce(
		(n, r) => n + r.failures.length,
		0,
	);
	const totalSkipped = results.reduce((n, r) => n + r.skipped.length, 0);
	const totalFiles = results.length;

	if (totalFailures === 0 && filesWithErrors.length === 0 && totalSkipped === 0)
		return null;

	const hasNewLabels = results.some((r) =>
		r.failures.some((f) => f.isNew !== undefined),
	);

	const newFailures = hasNewLabels
		? results.reduce(
				(n, r) => n + r.failures.filter((f) => f.isNew === true).length,
				0,
			)
		: 0;
	const existingFailures = hasNewLabels
		? results.reduce(
				(n, r) => n + r.failures.filter((f) => f.isNew === false).length,
				0,
			)
		: 0;
	const compiledCount = totalFiles - filesWithFailures.length - filesWithErrors.length;

	const lines: string[] = [];

	// Header with stats
	lines.push("### React Compiler Report");
	lines.push("");

	const stats: string[] = [];
	stats.push(`**${totalFiles}** files scanned`);
	if (compiledCount > 0) stats.push(`**${compiledCount}** compiled`);
	if (totalFailures > 0) {
		if (hasNewLabels) {
			if (newFailures > 0) stats.push(`**${newFailures}** new`);
			if (existingFailures > 0) stats.push(`${existingFailures} existing`);
		} else {
			stats.push(`**${totalFailures}** skipped`);
		}
	}
	if (filesWithErrors.length > 0) stats.push(`${filesWithErrors.length} errors`);
	lines.push(stats.join("  ·  "));
	lines.push("");

	// New issues table
	if (totalFailures > 0) {
		const newIssues = hasNewLabels
			? results.flatMap((r) =>
					r.failures
						.filter((f) => f.isNew === true)
						.map((f) => ({ file: r.file, failure: f })),
				)
			: results.flatMap((r) =>
					r.failures.map((f) => ({ file: r.file, failure: f })),
				);

		if (newIssues.length > 0) {
			if (hasNewLabels) {
				lines.push("#### New issues");
				lines.push("");
			}

			lines.push("| File | Component | Reason |");
			lines.push("|------|-----------|--------|");

			for (const { file, failure } of newIssues) {
				lines.push(formatFailureRow(file, failure, repoSlug, commitSha));
			}

			lines.push("");
		}

		// Existing issues (collapsed)
		if (hasNewLabels && existingFailures > 0) {
			const existingIssues = results.flatMap((r) =>
				r.failures
					.filter((f) => f.isNew === false)
					.map((f) => ({ file: r.file, failure: f })),
			);

			lines.push("<details>");
			lines.push(
				`<summary>${existingFailures} existing issue${existingFailures === 1 ? "" : "s"} (already on base branch)</summary>`,
			);
			lines.push("");
			lines.push("| File | Component | Reason |");
			lines.push("|------|-----------|--------|");

			for (const { file, failure } of existingIssues) {
				lines.push(formatFailureRow(file, failure, repoSlug, commitSha));
			}

			lines.push("");
			lines.push("</details>");
			lines.push("");
		}

		// Fix with AI (collapsed)
		const aiFailures = hasNewLabels
			? results
					.map((r) => ({
						...r,
						failures: r.failures.filter((f) => f.isNew === true),
					}))
					.filter((r) => r.failures.length > 0)
			: filesWithFailures;

		if (aiFailures.length > 0) {
			lines.push("<details>");
			lines.push("<summary>Fix with AI</summary>");
			lines.push("");
			lines.push("```");
			lines.push(
				"Fix the following React Compiler issues. The compiler skipped these components because they violate the Rules of React.",
			);
			lines.push("");
			lines.push("Rules:");
			lines.push(
				"- Do not add useMemo, useCallback, or React.memo. The compiler handles memoization once the code follows the rules.",
			);
			lines.push(
				"- Do not change the underlying logic or behavior of any component.",
			);
			lines.push(
				"- If a fix requires restructuring, extract helper functions rather than rewriting the component.",
			);
			lines.push("");

			for (const result of aiFailures) {
				lines.push(`File: ${result.file}`);

				for (const failure of result.failures) {
					lines.push(
						`  - ${failure.fnName ?? "(anonymous)"} (line ${failure.line}): ${failure.reason}`,
					);
					if (failure.description) {
						lines.push(`    ${failure.description}`);
					}
					if (failure.suggestions.length > 0) {
						for (const s of failure.suggestions) {
							lines.push(`    Suggestion: ${s}`);
						}
					}
				}

				lines.push("");
			}

			lines.push("```");
			lines.push("");
			lines.push("</details>");
		}
	}

	// Opt-outs (collapsed)
	if (totalSkipped > 0) {
		lines.push("");
		lines.push("<details>");
		lines.push(
			`<summary>${totalSkipped} opted out ("use no memo")</summary>`,
		);
		lines.push("");

		for (const result of results) {
			for (const skip of result.skipped) {
				const name = skip.fnName ?? "(anonymous)";
				lines.push(`- \`${result.file}:${skip.line}\` \`${name}\``);
			}
		}

		lines.push("");
		lines.push("</details>");
	}

	// Errors (collapsed)
	if (filesWithErrors.length > 0) {
		lines.push("");
		lines.push("<details>");
		lines.push(
			`<summary>${filesWithErrors.length} file${filesWithErrors.length === 1 ? "" : "s"} with errors</summary>`,
		);
		lines.push("");

		for (const result of filesWithErrors) {
			const firstLine = (result.error ?? "").split("\n")[0];
			lines.push(`- \`${result.file}\`: ${firstLine}`);
		}

		lines.push("");
		lines.push("</details>");
	}

	return lines.join("\n");
}
