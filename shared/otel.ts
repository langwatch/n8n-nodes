import { context, trace, TraceFlags } from '@opentelemetry/api';
import { IExecuteFunctions } from 'n8n-workflow';

export function getWorkflowExecutionContext($this: IExecuteFunctions): {
	traceId: string;
	spanId: string;
	withContext: <T>(fn: () => Promise<T>) => Promise<T>;
} {
	const staticData = $this.getWorkflowStaticData('global');
	if (!staticData.langwatchObservability) {
		throw new Error('No langwatchObservability found in workflow static data');
	}
	if (typeof staticData.langwatchObservability !== 'object') {
		throw new Error('langwatchObservability must be an object');
	}
	if (
		typeof staticData.langwatchObservability !== 'object' ||
		!('traceId' in staticData.langwatchObservability) ||
		!('spanId' in staticData.langwatchObservability)
	) {
		throw new Error('langwatchObservability must be an object with traceId and spanId');
	}

	const observabilityData = staticData.langwatchObservability as { traceId: string; spanId: string };
	const { traceId, spanId } = observabilityData;
	if (!traceId || !spanId) {
		throw new Error('No traceId or spanId found in workflow static data');
	}
	if (typeof traceId !== 'string' || typeof spanId !== 'string') {
		throw new Error('traceId and spanId must be strings');
	}

	return {
		traceId,
		spanId,
		withContext: <T>(fn: () => Promise<T>): Promise<T> => {
			// Create a new context with the parent span context
			const parentSpanContext = {
				traceId,
				spanId,
				traceFlags: TraceFlags.SAMPLED,
				isRemote: true,
			};

			// Wrap as a non-recording span and create a context
			const nonRecordingParent = trace.wrapSpanContext(parentSpanContext);
			const ctx = trace.setSpan(context.active(), nonRecordingParent);

			// Execute the function within this context
			return context.with(ctx, fn);
		},
	};
}

/**
 * Get the workflow trace and span IDs for manual context creation
 * Use this when you need to create spans manually
 */
export function getWorkflowTraceInfo($this: IExecuteFunctions): {
	traceId: string;
	spanId: string;
} {
	const staticData = $this.getWorkflowStaticData('global');
	if (!staticData.langwatchObservability) {
		throw new Error('No langwatchObservability found in workflow static data');
	}

	const observabilityData = staticData.langwatchObservability as { traceId: string; spanId: string };
	const { traceId, spanId } = observabilityData;
	if (!traceId || !spanId) {
		throw new Error('No traceId or spanId found in workflow static data');
	}

	return { traceId, spanId };
}

/**
 * Create a context with the workflow's parent span
 * Use this when you need to manually manage the context
 */
export function createWorkflowContext($this: IExecuteFunctions): ReturnType<typeof trace.setSpan> {
	const { traceId, spanId } = getWorkflowTraceInfo($this);

	const parentSpanContext = {
		traceId,
		spanId,
		traceFlags: TraceFlags.SAMPLED,
		isRemote: true,
	};

	const nonRecordingParent = trace.wrapSpanContext(parentSpanContext);
	return trace.setSpan(context.active(), nonRecordingParent);
}

/**
 * Create a context-aware LangChain model wrapper
 * This function takes a LangChain model and wraps its methods to run within the workflow context
 */
export function createContextAwareLangChainModel($this: IExecuteFunctions, model: any): any {
	const { traceId, spanId } = getWorkflowTraceInfo($this);

	// Create a context creation function
	const createContext = () => {
		const parentSpanContext = {
			traceId,
			spanId,
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		};

		const nonRecordingParent = trace.wrapSpanContext(parentSpanContext);
		return trace.setSpan(context.active(), nonRecordingParent);
	};

	// Create a copy of the model to avoid modifying the original
	const wrappedModel = { ...model };

	// Wrap all entry-point methods so they run under our context
	const methodsToWrap = ["invoke", "stream", "batch", "agenerate", "generate"];

	for (const methodName of methodsToWrap) {
		if (typeof model[methodName] === "function") {
			const originalMethod = model[methodName].bind(model);
			wrappedModel[methodName] = (...args: any[]) => {
				const ctx = createContext();
				return context.with(ctx, () => originalMethod(...args));
			};
		}
	}

	// Add the LangWatch callback handler if it's available
	try {
		const { LangWatchCallbackHandler } = require('langwatch/observability/instrumentation/langchain');
		if (LangWatchCallbackHandler) {
			const existingCallbacks = model.callbacks || [];
			wrappedModel.callbacks = [...existingCallbacks, new LangWatchCallbackHandler()];
		}
	} catch (error) {
		// LangWatch callback handler not available, continue without it
		console.warn('LangWatch callback handler not available:', error);
	}

	return wrappedModel;
}
