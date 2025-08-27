import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { setupObservability } from 'langwatch/observability/node';
import { getLangWatchTracer, type DataCaptureMode } from 'langwatch/observability';

export class LangWatchObservability implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LangWatch Observability (Deprecated)',
		name: 'langWatchObservability',
		icon: 'file:logo.svg',
		group: ['transform'],
		version: 1,
		description: 'Setup LangWatch observability',

		defaults: {
			name: 'LangWatch Observability (Deprecated)',
		},
		// allow placing it anywhere; pass items through if present
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],

		credentials: [
			{
				name: 'langwatchApi',
				required: true,
			},
		],

		properties: [
			{
				displayName: 'Service Name',
				name: 'serviceName',
				type: 'string',
				default: 'unnamed-workflow.langwatch',
			},
			{
				displayName: 'Data Capture',
				description: 'What data to capture',
				name: 'dataCapture',
				type: 'options',
				default: 'all',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'None', value: 'none' },
					{ name: 'Input Only', value: 'input' },
					{ name: 'Output Only', value: 'output' },
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const idx = 0;
		const input = this.getInputData();
		const serviceName = this.getNodeParameter('serviceName', idx, '') as string;
		const dataCapture = this.getNodeParameter('dataCapture', idx, 'all') as DataCaptureMode;

		const credentials = (await this.getCredentials('langwatchApi')) as {
			host?: string;
			apiKey: string;
		};

		// TOOD(afr): persist if this happened in global store!

		setupObservability({
			langwatch: {
				apiKey: credentials.apiKey,
				endpoint: credentials.host,
				processorType: 'simple',
			},
			traceExporter: new OTLPTraceExporter({
				url: 'http://localhost:4318/v1/traces',
			}),
			dataCapture,
			serviceName: 'n8n',
		});

		const tracer = getLangWatchTracer("langwatch-n8n");
		const span = tracer.startSpan("n8n Workflow");

		const staticData = this.getWorkflowStaticData("global");
		staticData.langwatchObservability = {
			traceId: span.spanContext().traceId,
			spanId: span.spanContext().spanId,
		};

		return [
			input,
			[
				{
					json: {
						observability: 'initialized',
						serviceName,
						dataCapture,
					},
				},
			],
		];
	}
}
