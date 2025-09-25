import {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	NodeOperationError,
} from 'n8n-workflow';
import type { LangWatchCredentials, LangWatchDatasetResponse, ProcessingOptions } from '../../shared/types';

export class LangWatchDatasetBatchTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LangWatch Dataset Batch Trigger',
		name: 'langWatchDatasetBatchTrigger',
		icon: 'file:logo.svg',
		group: ['trigger'],
		version: 1,
		description: 'Emit one item per dataset row sequentially until the dataset is done (with optional experiment context).',
		defaults: { name: 'When running a LangWatch dataset (batch)' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'langwatchApi', required: true }],
		properties: [
			{ displayName: 'Dataset Slug or ID', name: 'datasetId', type: 'string', required: true, default: '' },
			{
				displayName: 'Experiment Configuration',
				name: 'experimentConfig',
				type: 'collection',
				default: {},
				options: [
					{ displayName: 'Enable Experiment', name: 'enableExperiment', type: 'boolean', default: true },
					{ displayName: 'Experiment ID', name: 'experimentId', type: 'string', default: '' },
					{ displayName: 'Experiment Name', name: 'experimentName', type: 'string', default: '' },
					{ displayName: 'Experiment Slug', name: 'experimentSlug', type: 'string', default: '' },
					{ displayName: 'Workflow ID', name: 'workflowId', type: 'string', default: '' },
				],
			},
			{
				displayName: 'Row Processing Options',
				name: 'processingOptions',
				type: 'collection',
				default: {},
				options: [
					{ displayName: 'End Row', name: 'endRow', type: 'number', default: -1 },
					{ displayName: 'Limit Rows', name: 'limitRows', type: 'boolean', default: false },
					{ displayName: 'Max Rows', name: 'maxRows', type: 'number', default: 100, displayOptions: { show: { limitRows: [true] } } },
					{ displayName: 'Shuffle Rows', name: 'shuffleRows', type: 'boolean', default: false },
					{ displayName: 'Shuffle Seed', name: 'shuffleSeed', type: 'number', default: 0, displayOptions: { show: { shuffleRows: [true] } } },
					{ displayName: 'Start Row', name: 'startRow', type: 'number', default: 0 },
					{ displayName: 'Step Size', name: 'stepSize', type: 'number', default: 1 },
				],
			},
			{ displayName: 'Emit Interval (Ms)', name: 'emitIntervalMs', type: 'number', default: 0, description: 'Delay between emitted items' },
		],
	};

	async trigger(this: ITriggerFunctions) {
		const datasetId = this.getNodeParameter('datasetId') as string;
		const processingOptions = this.getNodeParameter('processingOptions') as ProcessingOptions & { shuffleSeed?: number };
		const experimentConfig = this.getNodeParameter('experimentConfig') as any;
		const emitIntervalMs = this.getNodeParameter('emitIntervalMs') as number;

		const {
			limitRows = false,
			maxRows = 100,
			startRow = 0,
			endRow,
			stepSize = 1,
			shuffleRows = false,
		} = processingOptions;

		const credentials = (await this.getCredentials('langwatchApi')) as LangWatchCredentials;

		let runId: string | null = null;
		let experimentInfo: any = null;

		if (experimentConfig.enableExperiment) {
			if (!experimentConfig.experimentId && !experimentConfig.experimentSlug) {
				throw new NodeOperationError(this.getNode(), 'Invalid experiment configuration', {
					message: 'Experiment is enabled but neither Experiment ID nor Experiment Slug is provided.',
					description: 'Provide an existing experiment ID or a slug for a new experiment.',
				});
			}
			runId = (globalThis as any)?.crypto?.randomUUID?.() ? (globalThis as any).crypto.randomUUID() : `run_${Date.now()}`;
			experimentInfo = await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
				baseURL: credentials.host,
				method: 'POST',
				url: '/api/experiment/init',
				json: true,
				body: {
					experiment_id: experimentConfig.experimentId || null,
					experiment_slug: experimentConfig.experimentSlug || null,
					experiment_type: 'BATCH_EVALUATION_V2',
					experiment_name: experimentConfig.experimentName || null,
					workflowId: experimentConfig.workflowId || null,
				},
			});
		}

		const data = (await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
			baseURL: credentials.host,
			method: 'GET',
			url: `/api/dataset/${datasetId}`,
			json: true,
		})) as LangWatchDatasetResponse;

		let rows: any[] = (data as any)?.data ?? [];
		if (!Array.isArray(rows) || rows.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No rows found in dataset', {
				message: `Dataset '${datasetId}' is empty or doesn't exist.`,
				description: 'Verify the dataset exists and has been populated with data.',
			});
		}

		if (shuffleRows) {
			let random = Math.random;
			const seed = processingOptions.shuffleSeed || 0;
			if (seed) {
				let s = seed >>> 0;
				random = () => {
					s ^= s << 13;
					s ^= s >>> 17;
					s ^= s << 5;
					return ((s >>> 0) % 1000000) / 1000000;
				};
			}
			for (let i = rows.length - 1; i > 0; i--) {
				const j = Math.floor(random() * (i + 1));
				[rows[i], rows[j]] = [rows[j], rows[i]];
			}
		}

		const startIndex = Math.max(0, startRow);
		const endIndex = endRow !== undefined && endRow !== -1 ? Math.min(endRow + 1, rows.length) : rows.length;
		rows = rows.slice(startIndex, endIndex);

		if (stepSize > 1) {
			rows = rows.filter((_, index) => index % stepSize === 0);
		}

		const effectiveTotal = limitRows ? Math.min(maxRows, rows.length) : rows.length;
		rows = rows.slice(0, effectiveTotal);

		let cancelled = false;
		const clear = () => { cancelled = true; };

		const emitRow = (row: any, index: number): INodeExecutionData => ({
			json: {
				row_number: index,
				_rowsLeft: Math.max(0, effectiveTotal - (index + 1)),
				_progress: {
					current: index + 1,
					total: effectiveTotal,
					percentage: Math.round(((index + 1) / effectiveTotal) * 100),
					remaining: Math.max(0, effectiveTotal - (index + 1)),
				},
				entry: row.entry,
				datasetId: row.datasetId,
				projectId: row.projectId,
				row_id: row.id,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				...(experimentInfo && {
					experiment: { slug: (experimentInfo as any).slug, path: (experimentInfo as any).path },
					runId,
					batchEvaluation: {
						enabled: true,
						runId,
						experimentId: experimentConfig.experimentId || null,
						experimentSlug: (experimentInfo as any).slug,
						workflowId: experimentConfig.workflowId || null,
					},
				}),
				_langwatch: {
					dataset: { id: row.datasetId, rowId: row.id, rowNumber: index },
					experiment: experimentInfo ? { slug: (experimentInfo as any).slug, path: (experimentInfo as any).path } : null,
					batch: experimentInfo ? { runId, workflowId: experimentConfig.workflowId || null } : null,
				},
			},
		});

		const run = async () => {
			for (let i = 0; i < rows.length && !cancelled; i++) {
				this.emit([[emitRow(rows[i], i)]]);
				if (emitIntervalMs > 0) {
					await new Promise((r) => setTimeout(r, emitIntervalMs));
				}
			}
		};
		void run();

		return {
			closeFunction: async () => { clear(); },
		};
	}
}


