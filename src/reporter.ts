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
					? `${prefix}${name} skipped by React Compiler: ${failure.reason}: ${failure.description}`
					: `${prefix}${name} skipped by React Compiler: ${failure.reason}`;

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

function formatFailureRow(
	file: string,
	failure: ParsedFailure,
	repoSlug: string | undefined,
	commitSha: string | undefined,
): string {
	const name = failure.fnName ?? "(anonymous)";
	const reasonText =
		failure.description && failure.description !== failure.reason
			? `${failure.reason}: ${failure.description}`
			: failure.reason;
	const severityTag = failure.severity ? `\`${failure.severity}\` ` : "";

	const fileDisplay =
		repoSlug && commitSha
			? `[\`${file}\`](https://github.com/${repoSlug}/blob/${commitSha}/${file}#L${failure.line})`
			: `\`${file}\``;

	const lineDisplay =
		repoSlug && commitSha
			? `[${failure.line}](https://github.com/${repoSlug}/blob/${commitSha}/${file}#L${failure.line})`
			: `${failure.line}`;

	return `| ${fileDisplay} | \`${name}\` | ${lineDisplay} | ${severityTag}${reasonText} |`;
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

	const lines: string[] = [];

	lines.push("## React Compiler Optimization Report");
	lines.push("");

	if (totalFailures > 0) {
		if (hasNewLabels) {
			const parts: string[] = [];
			if (newFailures > 0)
				parts.push(
					`**${newFailures}** new issue${newFailures === 1 ? "" : "s"} introduced in this PR`,
				);
			if (existingFailures > 0)
				parts.push(
					`${existingFailures} existing issue${existingFailures === 1 ? "" : "s"} in changed files`,
				);
			lines.push(parts.join(" · "));
		} else {
			const headline =
				totalFailures === 1
					? "React Compiler skipped **1** component"
					: `React Compiler skipped **${totalFailures}** components`;
			lines.push(headline);
		}
		lines.push("");

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
				lines.push("### New (introduced in this PR)");
				lines.push("");
			}

			lines.push("| File | Component | Line | Reason |");
			lines.push("|------|-----------|------|--------|");

			for (const { file, failure } of newIssues) {
				lines.push(formatFailureRow(file, failure, repoSlug, commitSha));
			}

			lines.push("");
		}

		if (hasNewLabels && existingFailures > 0) {
			const existingIssues = results.flatMap((r) =>
				r.failures
					.filter((f) => f.isNew === false)
					.map((f) => ({ file: r.file, failure: f })),
			);

			lines.push("<details>");
			lines.push(
				`<summary>Existing issues (${existingFailures}), already on the base branch</summary>`,
			);
			lines.push("");
			lines.push("| File | Component | Line | Reason |");
			lines.push("|------|-----------|------|--------|");

			for (const { file, failure } of existingIssues) {
				lines.push(formatFailureRow(file, failure, repoSlug, commitSha));
			}

			lines.push("");
			lines.push("</details>");
			lines.push("");
		}

		lines.push(
			"> [React Compiler](https://react.dev/learn/react-compiler) automatically memoizes components and hooks that follow the [Rules of React](https://react.dev/reference/rules). Fix the issues above so the compiler can memoize them. No manual `useMemo`, `useCallback`, or `React.memo` needed.",
		);
		lines.push("");

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
			lines.push(
				"<summary>Fix with AI: paste this into Claude or Cursor</summary>",
			);
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
						`  - Component: ${failure.fnName ?? "(anonymous)"} (line ${failure.line})`,
					);
					if (failure.severity) {
						lines.push(`    Severity: ${failure.severity}`);
					}
					lines.push(`    Error: ${failure.reason}`);
					if (failure.description) {
						lines.push(`    Description: ${failure.description}`);
					}
					if (failure.suggestions.length > 0) {
						lines.push("    Suggestions:");
						for (const s of failure.suggestions) {
							lines.push(`      - ${s}`);
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

	if (totalSkipped > 0) {
		lines.push("");
		lines.push("<details>");
		lines.push(
			`<summary>${totalSkipped} function(s) opted out via "use no memo"</summary>`,
		);
		lines.push("");

		for (const result of results) {
			for (const skip of result.skipped) {
				const name = skip.fnName ?? "(anonymous)";
				lines.push(`- \`${result.file}\`: \`${name}\` (line ${skip.line})`);
			}
		}

		lines.push("");
		lines.push("</details>");
	}

	if (filesWithErrors.length > 0) {
		if (totalFailures === 0) {
			lines.push(`**${filesWithErrors.length}** file(s) couldn't be analyzed`);
			lines.push("");
		}

		lines.push("<details>");
		lines.push(
			`<summary>Files with errors (${filesWithErrors.length})</summary>`,
		);
		lines.push("");

		for (const result of filesWithErrors) {
			lines.push(`- \`${result.file}\`: ${result.error}`);
		}

		lines.push("");
		lines.push("</details>");
	}

	return lines.join("\n");
}
