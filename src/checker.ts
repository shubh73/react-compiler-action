import * as babel from "@babel/core";
import * as parser from "@babel/parser";
import * as fs from "fs";
import * as path from "path";

import reactCompilerPlugin, {
	OPT_OUT_DIRECTIVES,
} from "babel-plugin-react-compiler";

import type {
	CompilerEvent,
	CompileDiagnosticEvent,
	CompileErrorEvent,
	CompilerDiagnosticDetail,
	PipelineErrorEvent,
	CompilationMode,
	FileResult,
	ParsedFailure,
	SkippedFunction,
	EventLocation,
} from "./types";

function extractFnNameFromSource(
	lines: string[],
	lineNum: number,
): string | undefined {
	const line = lines[lineNum - 1];
	if (!line) return undefined;

	const fnMatch = line.match(/function\s+([A-Za-z_$][\w$]*)/);
	if (fnMatch) return fnMatch[1];

	const constMatch = line.match(
		/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
	);
	if (constMatch) return constMatch[1];

	const defaultFnMatch = line.match(
		/export\s+default\s+function\s+([A-Za-z_$][\w$]*)/,
	);
	if (defaultFnMatch) return defaultFnMatch[1];

	return undefined;
}

function getLocationLine(
	loc: EventLocation | null | undefined,
): number | undefined {
	const line = loc?.start?.line;
	return typeof line === "number" ? line : undefined;
}

// Matches CompilerDiagnostic.primaryLocation(): returns the first `kind: "error"` detail's loc.
function getFirstDetailLine(
	details: Array<CompilerDiagnosticDetail> | null | undefined,
): number | undefined {
	for (const detail of details ?? []) {
		if (detail.kind !== "error") continue;
		const line = getLocationLine(detail.loc);
		if (line !== undefined) return line;
	}
	return undefined;
}

export function parseCompileError(
	event: CompileErrorEvent,
	sourceLines: string[],
): ParsedFailure {
	const detail = event.detail;
	const suggestions = (detail.suggestions ?? []).map((s) => s.description);
	// CompilerDiagnostic carries diagnostic-level locations via options.details;
	// CompilerErrorDetail exposes a single loc via its getter.
	const line =
		getFirstDetailLine(detail.options?.details) ??
		getLocationLine(detail.loc) ??
		getLocationLine(event.fnLoc) ??
		1;
	const fnName = extractFnNameFromSource(
		sourceLines,
		event.fnLoc?.start?.line ?? line,
	);

	return {
		reason: detail.reason,
		description: detail.description ?? "",
		severity: detail.severity,
		suggestions,
		line,
		fnName,
	};
}

export function parseCompileDiagnostic(
	event: CompileDiagnosticEvent,
	sourceLines: string[],
): ParsedFailure {
	const line =
		getLocationLine(event.detail.loc) ??
		getLocationLine(event.fnLoc) ??
		1;
	const fnName = extractFnNameFromSource(
		sourceLines,
		event.fnLoc?.start?.line ?? line,
	);

	return {
		reason: event.detail.reason,
		description: event.detail.description ?? "",
		severity: event.detail.category,
		suggestions: [],
		line,
		fnName,
	};
}

function parsePipelineError(
	event: PipelineErrorEvent,
	sourceLines: string[],
): ParsedFailure {
	const line = event.fnLoc?.start?.line ?? 1;
	const fnName = extractFnNameFromSource(sourceLines, line);

	return {
		reason: event.data || "Pipeline error",
		description: "",
		severity: "",
		suggestions: [],
		line,
		fnName,
	};
}

function failureKey(failure: ParsedFailure): string {
	return JSON.stringify([
		failure.fnName ?? "",
		failure.line,
		failure.severity,
		failure.reason,
		failure.description,
		failure.suggestions,
	]);
}

export function dedupeFailures(failures: ParsedFailure[]): ParsedFailure[] {
	const seen = new Set<string>();
	const deduped: ParsedFailure[] = [];

	for (const failure of failures) {
		const key = failureKey(failure);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(failure);
	}

	return deduped;
}

// The compiler emits no events for opt-out directives, so we detect them from the AST
function findUseNoMemoFunctions(
	ast: ReturnType<typeof parser.parse>,
	sourceLines: string[],
): SkippedFunction[] {
	const skipped: SkippedFunction[] = [];

	function checkDirectives(
		// biome-ignore lint: any is needed for loose AST node typing
		directives: any[] | undefined,
		fnName: string | undefined,
		line: number,
	) {
		if (!directives) return;
		for (const directive of directives) {
			const value = directive?.value?.value ?? directive?.expression?.value;
			if (typeof value === "string" && OPT_OUT_DIRECTIVES.has(value)) {
				skipped.push({ fnName, line, reason: value });
			}
		}
	}

	function walkNode(node: any) {
		if (!node || typeof node !== "object") return;

		if (
			node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression" ||
			node.type === "ArrowFunctionExpression"
		) {
			const body = node.body;
			if (body?.type === "BlockStatement") {
				const fnName =
					node.id?.name ??
					extractFnNameFromSource(sourceLines, node.loc?.start?.line ?? 1);
				checkDirectives(
					body.directives,
					fnName,
					node.loc?.start?.line ?? 1,
				);
				// Some parsers represent directives as expression statements
				const firstStmt = body.body?.[0];
				if (
					firstStmt?.type === "ExpressionStatement" &&
					firstStmt.expression?.type === "StringLiteral" &&
					OPT_OUT_DIRECTIVES.has(firstStmt.expression.value)
				) {
					const fnName =
						node.id?.name ??
						extractFnNameFromSource(
							sourceLines,
							node.loc?.start?.line ?? 1,
						);
					if (!skipped.some((s) => s.line === (node.loc?.start?.line ?? 1))) {
						skipped.push({
							fnName,
							line: node.loc?.start?.line ?? 1,
							reason: "use no memo",
						});
					}
				}
			}
		}

		for (const key of Object.keys(node)) {
			if (key === "loc" || key === "start" || key === "end") continue;
			const child = node[key];
			if (Array.isArray(child)) {
				for (const item of child) {
					if (item && typeof item === "object" && item.type) {
						walkNode(item);
					}
				}
			} else if (child && typeof child === "object" && child.type) {
				walkNode(child);
			}
		}
	}

	walkNode(ast.program);
	return skipped;
}

export function checkCode(
	code: string,
	filename: string,
	compilationMode: CompilationMode,
): FileResult {
	const events: CompilerEvent[] = [];

	let ast;
	try {
		ast = parser.parse(code, {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
			errorRecovery: true,
		});
	} catch (e) {
		return {
			file: filename,
			failures: [],
			skipped: [],
			error: `Parse error: ${(e as Error).message}`,
		};
	}

	try {
		babel.transformFromAstSync(ast, code, {
			filename,
			plugins: [
				[
					reactCompilerPlugin,
					{
						noEmit: true,
						compilationMode,
						panicThreshold: "none",
						logger: {
							logEvent(_filename: string, event: CompilerEvent) {
								events.push(event);
							},
						},
					},
				],
			],
			configFile: false,
			babelrc: false,
			code: false,
			ast: false,
		});
	} catch (e) {
		return {
			file: filename,
			failures: [],
			skipped: [],
			error: `Compiler error: ${(e as Error).message}`,
		};
	}

	const sourceLines = code.split("\n");

	const skipped = findUseNoMemoFunctions(ast, sourceLines);

	const failures: ParsedFailure[] = [];
	for (const event of events) {
		if (event.kind === "CompileError") {
			failures.push(
				parseCompileError(event as CompileErrorEvent, sourceLines),
			);
		} else if (event.kind === "CompileDiagnostic") {
			failures.push(
				parseCompileDiagnostic(event as CompileDiagnosticEvent, sourceLines),
			);
		} else if (event.kind === "PipelineError") {
			failures.push(
				parsePipelineError(event as PipelineErrorEvent, sourceLines),
			);
		}
	}

	return { file: filename, failures: dedupeFailures(failures), skipped };
}

export function checkFile(
	filePath: string,
	compilationMode: CompilationMode,
): FileResult {
	const absolutePath = path.resolve(filePath);
	let code: string;

	try {
		code = fs.readFileSync(absolutePath, "utf-8");
	} catch {
		return {
			file: filePath,
			failures: [],
			skipped: [],
			error: `Could not read file: ${filePath}`,
		};
	}

	return checkCode(code, absolutePath, compilationMode);
}
