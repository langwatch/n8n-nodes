import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionTypes,
    NodeOperationError,
    ILoadOptionsFunctions,
    INodePropertyOptions,
} from 'n8n-workflow';
import type { LangWatchCredentials } from '../../shared/types';

export class LangWatchEvaluation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LangWatch Evaluation',
		name: 'langWatchEvaluation',
		icon: 'file:logo.svg',
		group: ['transform'],
		version: 1,
		description:
			'Check if evaluating, record results, run and record evaluators, or set outputs to dataset',
		defaults: { name: 'LangWatch Evaluation' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],

		credentials: [{ name: 'langwatchApi', required: true }],

			hints: [
				{
					message:
						'Auto chooses based on provided fields: Dataset slug/custom outputs ➜ Set Outputs; Evaluator/Eval data ➜ Run and Record; Result JSON ➜ Record Result; otherwise ➜ Check If Evaluating.',
					type: 'info',
					location: 'inputPane',
					whenToDisplay: 'always',
					displayCondition: '={{ true }}',
				},
				{
					message:
						'Outputs: Output 1 = success/yes. Output 2 = no/else (only used by “Check If Evaluating”).',
					type: 'info',
					location: 'outputPane',
					whenToDisplay: 'always',
					displayCondition: '={{ true }}',
				},
			],

		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'auto',
				options: [
					{ name: 'Auto (Recommended)', value: 'auto' },
					{ name: 'Check If Evaluating', value: 'checkIfEvaluating' },
					{ name: 'Record Result', value: 'recordResult' },
					{ name: 'Run and Record', value: 'runAndRecord' },
					{ name: 'Set Outputs (Dataset)', value: 'setOutputs' },
				],
			},

			// Record Result
			{
				displayName: 'Result',
				name: 'result',
				type: 'json',
				default: '{}',
				description:
					'Evaluation result JSON (supports expressions)',
				displayOptions: { show: { operation: ['recordResult'] } },
				hint:
					'Provide evaluator output to record. Example: {"metric":"custom","passed":true,"score":0.9,"inputs":{"input":"={{$json.input}}","output":"={{$json.output}}"}}. If this node also runs the evaluator, you do not need to fill this.',
			},
			{
				displayName: 'Run ID (Optional)',
				name: 'runId',
				type: 'string',
				default: '',
				description:
					'Override the run ID. By default, this is inferred from upstream dataset/evaluation context (_langwatch.batch.runId).',
				placeholder: '{{ $json._langwatch?.batch?.runId || $json.runId }}',
				displayOptions: { show: { operation: ['recordResult', 'runAndRecord', 'auto'] } },
			},

			// Run and Record
			{
				displayName: 'Evaluator Selection Method',
				name: 'evaluatorSelectionMethod',
				type: 'options',
				default: 'manual',
				options: [
					{ name: 'Manual Input', value: 'manual', description: 'Type evaluator name or ID' },
					{
						name: 'Select From Dropdown',
						value: 'dropdown',
						description: 'Pick from available evaluators (fetched from LangWatch)',
					},
				],
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
			},
			{
				displayName: 'Evaluator Name or ID',
				name: 'evaluatorId',
				type: 'string',
				default: '',
				required: true,
				description: 'ID or name of the evaluator to run',
				displayOptions: { show: { operation: ['runAndRecord', 'auto'], evaluatorSelectionMethod: ['manual'] } },
				placeholder: 'langevals/llm_boolean, langevals/llm_score, or custom/... ID',
			},
			{
				displayName: 'Evaluator Name or ID',
				name: 'evaluatorSelect',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getEvaluators' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: { operation: ['runAndRecord', 'auto'], evaluatorSelectionMethod: ['dropdown'] },
				},
			},
			{
				displayName: 'Evaluation Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
				placeholder: 'accuracy_check',
				description: 'Friendly name for this evaluation execution',
			},
			{
				displayName: 'Evaluation Data',
				name: 'evaluationData',
				type: 'json',
				default: '{ "input": "", "output": "" }',
				required: true,
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
				description: 'Payload for the evaluator (e.g., input/output/expected)',
				hint: 'Provide the data fields your evaluator expects.',
			},
			{
				displayName: 'Evaluator Settings',
				name: 'evaluatorSettings',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
				description: 'Optional evaluator-specific settings (thresholds, etc.)',
			},
			{
				displayName: 'Act as Guardrail',
				name: 'asGuardrail',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
				description: 'Whether to act as a guardrail and enforce evaluation results',
			},
			{
				displayName: 'Fail Workflow if Evaluation Fails',
				name: 'failOnFail',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['runAndRecord', 'auto'] } },
			},

			// Set Outputs (Dataset)
			{
				displayName: 'Dataset Slug',
				name: 'datasetSlug',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['setOutputs', 'auto'] } },
				description: 'POST /api/dataset/{slug}/entries',
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				default: 'standard',
				displayOptions: { show: { operation: ['setOutputs', 'auto'] } },
				options: [
					{ name: 'Standard (Input/Output/Expected)', value: 'standard' },
					{ name: 'Custom Mapping', value: 'custom' },
				],
			},
			{
				displayName: 'Input Path',
				name: 'inputPath',
				type: 'string',
				default: '={{$json.input}}',
				displayOptions: { show: { operation: ['setOutputs', 'auto'], format: ['standard'] } },
				description: 'Expression to the input value in the incoming item',
			},
			{
				displayName: 'Output Path',
				name: 'outputPath',
				type: 'string',
				default: '={{$json.output}}',
				displayOptions: { show: { operation: ['setOutputs', 'auto'], format: ['standard'] } },
				description: 'Expression to the output value in the incoming item',
			},
			{
				displayName: 'Expected Path',
				name: 'expectedPath',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['setOutputs', 'auto'], format: ['standard'] } },
				description: 'Optional expression to the expected/ground-truth value',
			},
			{
				displayName: 'Custom Outputs',
				name: 'outputs',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add field',
				displayOptions: { show: { operation: ['setOutputs', 'auto'], format: ['custom'] } },
				options: [
					{
						name: 'fields',
						displayName: 'Fields',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Include Row Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['setOutputs', 'auto'] } },
				description:
					'Whether to include _meta.row_id and _meta.row_number when available (useful to correlate back to dataset rows)',
			},
		],
	};

	methods = {
		loadOptions: {
			async getEvaluators(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials('langwatchApi')) as {
					host: string;
					apiKey: string;
				};

				const response = await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
					baseURL: credentials.host,
					method: 'GET',
					url: '/api/evaluations/list',
				});

				const data = typeof response === 'string' ? JSON.parse(response) : response;
				const evaluators = (data?.evaluators as Record<string, any>) || {};

				return Object.entries(evaluators).map(([key, evaluator]) => ({
					name: (evaluator as any)?.name || key,
					value: key,
					description: (evaluator as any)?.description || key,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0, 'auto') as string;

		const getCtx = (i: number) => {
			const j = items[i]?.json as any;
			return j?._langwatch?.batch || j?.batchEvaluation || null;
		};

		const credentials = (await this.getCredentials('langwatchApi')) as LangWatchCredentials;

		const resolveOperation = (i: number): 'checkIfEvaluating' | 'recordResult' | 'runAndRecord' | 'setOutputs' => {
			if (operation !== 'auto') return operation as any;

			const hasDatasetSlug = !!(this.getNodeParameter('datasetSlug', i, '') as string);
			const isCustomFormat = (this.getNodeParameter('format', i, 'standard') as string) === 'custom';
			const customFields = (((this.getNodeParameter('outputs', i, {}) as any) || {}).fields ?? []) as any[];

			const selection = this.getNodeParameter('evaluatorSelectionMethod', i, 'manual') as string;
			const hasEvaluator =
				!!(selection === 'dropdown'
					? (this.getNodeParameter('evaluatorSelect', i, '') as string)
					: (this.getNodeParameter('evaluatorId', i, '') as string));
			const evalDataRaw = this.getNodeParameter('evaluationData', i, '') as string;
			const hasEvalData = !!evalDataRaw && evalDataRaw !== '{}' && evalDataRaw !== '""';

			const resultRaw = this.getNodeParameter('result', i, '') as string;
			const hasResultParam = !!resultRaw && resultRaw !== '{}' && resultRaw !== '""';
			const hasResultInItem = (items[i]?.json as any)?.evaluation !== undefined;

			if (hasDatasetSlug || (isCustomFormat && customFields.length > 0)) return 'setOutputs';
			if (hasEvaluator || hasEvalData) return 'runAndRecord';
			if (hasResultParam || hasResultInItem) return 'recordResult';
			return 'checkIfEvaluating';
		};

		const logBatch = async (i: number, evaluation: any): Promise<void> => {
			const ctx = getCtx(i);
			const runId = (this.getNodeParameter('runId', i, '') as string) || ctx?.runId || null;
			if (!runId) return;

			const prog = (items[i]?.json as any)?._progress;
			const current = prog?.current ?? null;
			const total = prog?.total ?? null;
			const isFinished = current != null && total != null && current === total;

			const body: any = {
				run_id: runId,
				experiment_id: ctx?.experimentId || null,
				experiment_slug: ctx?.experimentSlug || null,
				name: (this.getNodeParameter('name', i, '') as string) || evaluation?.name || null,
				workflow_id: ctx?.workflowId || null,
				evaluations: [evaluation],
				progress: current ?? null,
				total: total ?? null,
				timestamps: {
					created_at: Date.now(),
					finished_at: isFinished ? Date.now() : null,
					stopped_at: null,
				},
			};

			await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
				baseURL: credentials.host,
				method: 'POST',
				url: '/api/evaluations/batch/log_results',
				json: true,
				body,
			});
		};

		switch (resolveOperation(0)) {
			case 'checkIfEvaluating': {
			const yes: INodeExecutionData[] = [];
			const no: INodeExecutionData[] = [];
			for (let i = 0; i < items.length; i++) {
				const isEvaluating = !!(getCtx(i)?.runId);
				const out = { json: { ...(items[i].json as any), isEvaluating }, pairedItem: { item: i } };
				(isEvaluating ? yes : no).push(out);
			}
			return [yes, no];
		}


		case 'recordResult': {
			const out: INodeExecutionData[] = [];
			for (let i = 0; i < items.length; i++) {
				const resultRaw = this.getNodeParameter('result', i, '{}') as string | any;
				const evaluation = typeof resultRaw === 'string' && resultRaw ? JSON.parse(resultRaw) : resultRaw;

				await logBatch(i, evaluation);

				out.push({
					json: {
						...(items[i].json as any),
						_langwatch: {
							...(items[i].json as any)?._langwatch,
							recorded: true,
							lastEvaluation: evaluation,
						},
					},
					pairedItem: { item: i },
				});
			}
			return [out, []];
		}

		case 'runAndRecord': {
			const out: INodeExecutionData[] = [];
			for (let i = 0; i < items.length; i++) {
				const selectionMethod = this.getNodeParameter('evaluatorSelectionMethod', i, 'manual') as string;
				const evaluatorId = (selectionMethod === 'dropdown'
					? (this.getNodeParameter('evaluatorSelect', i, '') as string)
					: (this.getNodeParameter('evaluatorId', i, '') as string)) as string;
				if (!evaluatorId) {
					throw new NodeOperationError(this.getNode(), 'Missing evaluator ID', {
						message: 'No evaluator selected. Choose an evaluator manually or from the dropdown.',
					});
				}
				const name = this.getNodeParameter('name', i, '') as string;
				const asGuardrail = this.getNodeParameter('asGuardrail', i, false) as boolean;
				const failOnFail = this.getNodeParameter('failOnFail', i, true) as boolean;
				const evaluationDataRaw = this.getNodeParameter('evaluationData', i, '{}') as string | any;
				const evaluatorSettingsRaw = this.getNodeParameter('evaluatorSettings', i, '{}') as string | any;

				const parseJson = (v: any) => (typeof v === 'string' && v ? JSON.parse(v) : v || {});
				const evaluationData = parseJson(evaluationDataRaw);
				const evaluatorSettings = parseJson(evaluatorSettingsRaw);

				const evaluation = await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
					baseURL: credentials.host,
					method: 'POST',
					url: `/api/evaluations/${encodeURIComponent(evaluatorId)}/evaluate`,
					json: true,
					body: { name, data: evaluationData, as_guardrail: asGuardrail, settings: evaluatorSettings },
				});

				if (failOnFail && (evaluation as any)?.passed === false) {
					throw new NodeOperationError(this.getNode(), 'Evaluation failed', {
						message: (evaluation as any)?.details,
					});
				}

				await logBatch(i, evaluation);

				out.push({
					json: {
						...(items[i].json as any),
						evaluation,
						_langwatch: {
							...(items[i].json as any)?._langwatch,
							recorded: true,
						},
					},
					pairedItem: { item: i },
				});
			}
			return [out, []];
		}

		case 'setOutputs': {
			const datasetSlug = this.getNodeParameter('datasetSlug', 0, '') as string;
			if (!datasetSlug) throw new NodeOperationError(this.getNode(), 'Dataset slug is required');

			const format = this.getNodeParameter('format', 0, 'standard') as string;
			const includeMetadata = this.getNodeParameter('includeMetadata', 0, true) as boolean;

			const entries: any[] = [];
			for (let i = 0; i < items.length; i++) {
				let entry: Record<string, any>;
				if (format === 'standard') {
					const inputPath = this.getNodeParameter('inputPath', i, '') as any;
					const outputPath = this.getNodeParameter('outputPath', i, '') as any;
					const expectedPath = this.getNodeParameter('expectedPath', i, '') as any;
					entry = {
						input: inputPath,
						output: outputPath,
						...(expectedPath ? { expected: expectedPath } : {}),
					};
				} else {
					const outputsCollection = this.getNodeParameter('outputs', i, {}) as { fields?: Array<{ name: string; value: any }> };
					const mapping: Record<string, any> = {};
					for (const f of outputsCollection.fields ?? []) {
						if (!f?.name) throw new NodeOperationError(this.getNode(), 'Output field name is required');
						mapping[f.name] = f.value;
					}
					entry = mapping;
				}

				if (includeMetadata) {
					const rowId = (items[i].json as any)?._langwatch?.dataset?.rowId ?? (items[i].json as any)?.row_id ?? null;
					const rowNumber = (items[i].json as any)?._langwatch?.dataset?.rowNumber ?? (items[i].json as any)?.row_number ?? null;
					entry._meta = { row_id: rowId, row_number: rowNumber };
				}
				entries.push(entry);
			}

			await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
				baseURL: credentials.host,
				method: 'POST',
				url: `/api/dataset/${encodeURIComponent(datasetSlug)}/entries`,
				json: true,
				body: { entries },
			});

			const out1 = items.map((it, idx) => ({
				json: {
					...(it.json as any),
					_langwatch: {
						...(it.json as any)?._langwatch,
						datasetWrite: { datasetSlug, index: idx, written: true },
					},
				},
				pairedItem: { item: idx },
			}));
			return [out1, []];
		}

		default:
			throw new NodeOperationError(this.getNode(), `Unsupported operation`);
		}
	}
}


