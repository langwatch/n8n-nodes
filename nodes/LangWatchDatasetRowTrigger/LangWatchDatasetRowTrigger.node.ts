import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import type {
	LangWatchCredentials,
	LangWatchDatasetResponse,
	ProcessingOptions,
} from '../../shared/types';

export class LangWatchDatasetRowTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LangWatch Dataset Row Trigger',
		name: 'langWatchDatasetRowTrigger',
		icon: 'file:logo.svg',
		group: ['trigger'],
		version: 1,
		description: 'Emit one dataset row per execution, maintaining an internal cursor (no experiment context).',
		defaults: { name: 'When fetching a LangWatch dataset row' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],

		credentials: [
			{ name: 'langwatchApi', required: true },
		],

		hints: [],

		properties: [
			{
				displayName: 'Dataset Slug or ID',
				name: 'datasetId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID or slug of the LangWatch dataset to process',
				placeholder: 'my-dataset or dataset-ID',
			},
			{
				displayName: 'Row Processing Options',
				name: 'processingOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{ displayName: 'End Row', name: 'endRow', type: 'number', default: -1, description: 'Row index to stop at (0-based, -1 = all rows)' },
					{ displayName: 'Limit Rows', name: 'limitRows', type: 'boolean', default: false, description: 'Whether to limit number of rows' },
					{ displayName: 'Max Rows to Process', name: 'maxRows', type: 'number', default: 10, displayOptions: { show: { limitRows: [true] } }, description: 'Maximum number of rows' },
					{ displayName: 'Reset Progress', name: 'resetProgress', type: 'boolean', default: false, description: 'Whether to reset internal cursor and cached dataset' },
					{ displayName: 'Shuffle Rows', name: 'shuffleRows', type: 'boolean', default: false, description: 'Whether to randomize the order once per reset' },
					{ displayName: 'Shuffle Seed', name: 'shuffleSeed', type: 'number', default: 0, description: 'Seed for deterministic shuffle (0 = random)', displayOptions: { show: { shuffleRows: [true] } } },
					{ displayName: 'Start Row', name: 'startRow', type: 'number', default: 0, description: 'Row index to start from (0-based)' },
					{ displayName: 'Step Size', name: 'stepSize', type: 'number', default: 1, description: 'Process every Nth row (1 = every row)' },
				],
			},
		],
	};

	methods = { loadOptions: {} as Record<string, never> };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const datasetId = this.getNodeParameter('datasetId', 0) as string;
		const processingOptions = this.getNodeParameter('processingOptions', 0) as ProcessingOptions & { resetProgress?: boolean; shuffleSeed?: number };

		const {
			limitRows = false,
			maxRows = 10,
			startRow = 0,
			endRow,
			stepSize = 1,
			shuffleRows = false,
		} = processingOptions;

		const credentials = (await this.getCredentials('langwatchApi')) as LangWatchCredentials;

		try {
			const staticData = this.getWorkflowStaticData('node') as {
				processedDataset?: any[];
				datasetId?: string;
				shuffleRows?: boolean;
				shuffleSeed?: number;
				cursor?: number;
			};

			const needsReload = processingOptions.resetProgress === true ||
				!staticData.processedDataset ||
				staticData.datasetId !== datasetId ||
				staticData.shuffleRows !== shuffleRows ||
				staticData.shuffleSeed !== processingOptions.shuffleSeed;

			let datasetEntries: any[];

			if (needsReload) {
				const data = (await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
					baseURL: credentials.host,
					method: 'GET',
					url: `/api/dataset/${datasetId}`,
					json: true,
				})) as LangWatchDatasetResponse;
				datasetEntries = (data as any)?.data || [];

				if (!Array.isArray(datasetEntries) || datasetEntries.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No rows found in dataset', {
						message: `Dataset '${datasetId}' is empty or doesn't exist.`,
						description: 'Verify the dataset exists and has data.',
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
					for (let i = datasetEntries.length - 1; i > 0; i--) {
						const j = Math.floor(random() * (i + 1));
						[datasetEntries[i], datasetEntries[j]] = [datasetEntries[j], datasetEntries[i]];
					}
				}

				staticData.processedDataset = datasetEntries;
				staticData.datasetId = datasetId;
				staticData.shuffleRows = shuffleRows;
				staticData.shuffleSeed = processingOptions.shuffleSeed || 0;
				staticData.cursor = 0;
			} else {
				datasetEntries = staticData.processedDataset!;
			}

			const startIndex = Math.max(0, startRow);
			const endIndex = endRow !== undefined && endRow !== -1 ? Math.min(endRow + 1, datasetEntries.length) : datasetEntries.length;
			datasetEntries = datasetEntries.slice(startIndex, endIndex);

			if (stepSize > 1) {
				datasetEntries = datasetEntries.filter((_, index) => index % stepSize === 0);
			}

			const currentIndex = Math.max(0, staticData.cursor ?? 0);
			const effectiveTotal = limitRows ? Math.min(maxRows, datasetEntries.length) : datasetEntries.length;

			if (currentIndex >= effectiveTotal) {
				throw new NodeOperationError(this.getNode(), 'No row found', {
					message: 'All rows have been processed',
					description: `Processed ${effectiveTotal} rows from dataset '${datasetId}'.`,
				});
			}

			const currentRowData = datasetEntries[currentIndex];
			const rowsLeft = Math.max(0, effectiveTotal - (currentIndex + 1));

			const outputData: Record<string, any> = {
				row_number: currentIndex,
				_rowsLeft: rowsLeft,
				_progress: {
					current: currentIndex + 1,
					total: effectiveTotal,
					percentage: Math.round(((currentIndex + 1) / effectiveTotal) * 100),
					remaining: rowsLeft,
				},
				entry: currentRowData.entry,
				datasetId: currentRowData.datasetId,
				projectId: currentRowData.projectId,
				row_id: currentRowData.id,
				createdAt: currentRowData.createdAt,
				updatedAt: currentRowData.updatedAt,
				_langwatch: {
					dataset: { id: currentRowData.datasetId, rowId: currentRowData.id, rowNumber: currentIndex },
				},
			};

			staticData.cursor = currentIndex + 1;

			const currentRow: INodeExecutionData = { json: outputData };
			return [[currentRow]];
		} catch (error) {
			if (error instanceof NodeOperationError) throw error;
			throw new NodeOperationError(this.getNode(), 'Failed to fetch dataset row', {
				message: `Error fetching row from dataset '${datasetId}': ${(error as any)?.message}`,
				description: 'Check your dataset ID, API credentials, and network connection.',
			});
		}
	}
}


