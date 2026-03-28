export type EventLocation = {
	start?: { line?: number; column?: number };
	end?: { line?: number; column?: number };
};

export type CompileErrorEvent = {
	kind: "CompileError";
	fnLoc?: EventLocation;
	detail: {
		reason: string;
		description?: string | null;
		severity: string;
		loc?: EventLocation | null;
		suggestions?: Array<{ description: string; [key: string]: unknown }> | null;
		// CompilerErrorDetail class instances expose fields via getters
		// AND have an `options` property with the same shape
		options?: {
			reason?: string;
			description?: string | null;
			severity?: string;
			loc?: EventLocation | null;
			suggestions?:
				| Array<{ description: string; [key: string]: unknown }>
				| null;
		};
	};
};

export type PipelineErrorEvent = {
	kind: "PipelineError";
	fnLoc?: EventLocation;
	data: string;
};

export type CompileSuccessEvent = {
	kind: "CompileSuccess";
	fnLoc?: EventLocation;
	fnName?: string | null;
};

export type CompilerEvent =
	| CompileErrorEvent
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
	skipped: SkippedFunction[];
	error?: string;
};

export type SkippedFunction = {
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
