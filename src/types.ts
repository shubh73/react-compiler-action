// Matches @babel/types SourceLocation: start/end are required and contain line/column.
export type EventLocation = {
	start: { line: number; column: number };
	end?: { line: number; column: number };
};

export type CompilerDiagnosticDetail =
	| {
			kind: "error";
			loc: EventLocation | null;
			message: string | null;
	  }
	| {
			kind: "hint";
			message: string;
	  };

export type CompileErrorEvent = {
	kind: "CompileError";
	fnLoc: EventLocation | null;
	// detail is a CompilerDiagnostic or CompilerErrorDetail instance.
	// Both expose parsed fields via getters; only CompilerDiagnostic.options carries details.
	detail: {
		reason: string;
		description?: string | null;
		severity: string;
		loc?: EventLocation | null;
		suggestions?: Array<{ description: string; [key: string]: unknown }> | null;
		options?: {
			details?: Array<CompilerDiagnosticDetail> | null;
		};
	};
};

export type CompileDiagnosticEvent = {
	kind: "CompileDiagnostic";
	fnLoc: EventLocation | null;
	detail: {
		category: string;
		reason: string;
		description?: string | null;
		loc: EventLocation | null;
	};
};

export type PipelineErrorEvent = {
	kind: "PipelineError";
	fnLoc: EventLocation | null;
	data: string;
};

export type CompileSuccessEvent = {
	kind: "CompileSuccess";
	fnLoc: EventLocation | null;
	fnName?: string | null;
};

export type CompilerEvent =
	| CompileErrorEvent
	| CompileDiagnosticEvent
	| PipelineErrorEvent
	| CompileSuccessEvent
	| { kind: string; [key: string]: unknown };

export type ParsedFailure = {
	reason: string;
	description: string;
	severity: string;
	suggestions: string[];
	line: number;
	fnName: string | undefined;
	/** true = introduced in this PR, false = existed on base branch, undefined = full-scan mode */
	isNew?: boolean;
};

export type FileResult = {
	file: string;
	failures: ParsedFailure[];
	skipped: MemoDirectiveFunction[];
	optedIn?: MemoDirectiveFunction[];
	error?: string;
};

export type MemoDirectiveFunction = {
	fnName: string | undefined;
	line: number;
	reason: string;
};

export type CompilationMode = "infer" | "all" | "annotation";

export type AnnotationLevel = "warning" | "error" | "notice";

export type ActionInputs = {
	token: string;
	changedFilesOnly: boolean;
	failOnError: boolean;
	postComment: boolean;
	annotations: boolean;
	annotationLevel: AnnotationLevel;
	compilationMode: CompilationMode;
	workingDirectory: string;
	includePatterns: string[];
	excludePatterns: string[];
};
