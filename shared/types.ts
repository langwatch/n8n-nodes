// Common LangWatch API types for n8n nodes

// Types for LangWatch API credentials
export interface LangWatchCredentials {
	host: string;
	apiKey: string;
}

// Type for the dynamic entry data (varies by dataset)
export type DatasetEntry = Record<string, any>;

// Type for a single dataset row from LangWatch API
export interface LangWatchDatasetRow {
	id: string;
	datasetId: string;
	projectId: string;
	entry: DatasetEntry;
	createdAt: string;
	updatedAt: string;
}

// Type for the API response structure
export interface LangWatchDatasetResponse {
	data: LangWatchDatasetRow[];
}

// Type for the output data structure
export interface DatasetRowOutput {
	// Dynamic entry fields (spread from entry)
	[key: string]: any;
	// Known metadata fields
	datasetId: string;
	projectId: string;
	row_number: number;
	row_id: string;
	_rowsLeft: number;
}

// Type for previous execution data
export interface PreviousExecutionData {
	row_number?: number;
	_rowsLeft?: number;
}

// Common API response wrapper
export interface LangWatchApiResponse<T = any> {
	data: T;
	message?: string;
	status?: string;
}

// Variable mapping types for prompts
export interface VariableMapping {
	name: string;
	value: string;
}

export interface InputDataVariableMapping {
	name: string;
	dataPath: string;
}

export interface VariablesCollection {
	variables?: VariableMapping[];
}

export interface InputDataVariablesCollection {
	variables?: InputDataVariableMapping[];
}

export type TemplateVariables = Record<string, any>;

// Evaluation types
export interface EvaluationRequest {
	evaluatorId: string;
	name: string;
	asGuardrail?: boolean;
	inputs?: Record<string, any>;
	expectedOutput?: any;
}

export interface EvaluationResponse {
	id: string;
	score?: number;
	passed?: boolean;
	reason?: string;
	details?: any;
}

// Dataset Row Trigger parameter types
export interface ProcessingOptions {
	limitRows?: boolean;
	maxRows?: number;
	startRow?: number;
	endRow?: number;
	stepSize?: number;
	shuffleRows?: boolean;
}

// Observability types
export interface ObservabilityConfig {
	serviceName: string;
	dataCapture: 'all' | 'inputs' | 'outputs' | 'none';
	endpoint?: string;
	apiKey?: string;
}

// Workflow execution context types
export interface WorkflowExecutionContext {
	traceId: string;
	spanId: string;
	withContext: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface WorkflowTraceInfo {
	traceId: string;
	spanId: string;
}
