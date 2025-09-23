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
		displayName: 'LangWatch Dataset Evaluation Trigger',
		name: 'langWatchDatasetRowTrigger',
		icon: "file:logo.svg",
		group: ['trigger'],
		version: 1,
		description: 'Run a LangWatch dataset though your workflow to check performance and accuracy.',
		defaults: {
			name: 'When fetching a LangWatch dataset row',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],

		credentials: [
			{
				name: 'langwatchApi',
				required: true,
			}
		],

		hints: [
			{
				message: 'This trigger processes dataset rows one at a time. Each execution returns the next row in sequence.',
				type: 'info',
				location: 'inputPane',
				whenToDisplay: 'always',
			},
			{
				message: 'Use "Limit Rows" to test with a smaller subset before processing the entire dataset.',
				type: 'info',
				location: 'inputPane',
				whenToDisplay: 'always',
				displayCondition: '={{ !$parameter["limitRows"] }}',
			},
			{
				message: 'Each row includes progress tracking metadata (row_number, _rowsLeft) to help you monitor processing.',
				type: 'info',
				location: 'outputPane',
				whenToDisplay: 'always',
			},
		],

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
					{
						displayName: 'End Row',
						name: 'endRow',
						type: 'number',
						default: '',
						description: 'Row index to stop processing at (0-based, leave empty for all rows)',
					},
					{
						displayName: 'Limit Rows',
						name: 'limitRows',
						type: 'boolean',
						default: false,
						description: 'Whether to limit the number of rows to process',
					},
					{
						displayName: 'Max Rows to Process',
						name: 'maxRows',
						type: 'number',
						default: 10,
						displayOptions: {
							show: {
								limitRows: [true],
							},
						},
						description: 'Maximum number of rows to process during evaluation',
					},
					{
						displayName: 'Shuffle Rows',
						name: 'shuffleRows',
						type: 'boolean',
						default: false,
						description: 'Whether to randomize the order of rows before processing',
					},
					{
						displayName: 'Start Row',
						name: 'startRow',
						type: 'number',
						default: 0,
						description: 'Row index to start processing from (0-based)',
					},
					{
						displayName: 'Step Size',
						name: 'stepSize',
						type: 'number',
						default: 1,
						description: 'Process every Nth row (1 = every row, 2 = every other row, etc.)',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {} as Record<string, never>,
	};

	// TODO: Add methods when dataset listing API is available
	// methods = {
	// 	loadOptions: {
	// 		async getDatasets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	// 			const credentials = await this.getCredentials('langwatchApi') as LangWatchCredentials;
	//
	// 			const response = await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
	// 				baseURL: credentials.host,
	// 				method: 'GET',
	// 				url: '/api/datasets',
	// 			});
	//
	// 			const data = JSON.parse(response);
	// 			return data.data.map((dataset: any) => ({
	// 				name: dataset.name || dataset.slug || dataset.id,
	// 				value: dataset.id,
	// 				description: dataset.slug ? `Slug: ${dataset.slug}` : `ID: ${dataset.id}`,
	// 			}));
	// 		},
	// 	},
	// };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputData = this.getInputData();
		const datasetId = this.getNodeParameter('datasetId', 0) as string;
		const processingOptions = this.getNodeParameter('processingOptions', 0) as ProcessingOptions;

		const {
			limitRows = false,
			maxRows = 10,
			startRow = 0,
			endRow,
			stepSize = 1,
			shuffleRows = false,
		} = processingOptions;

		// Get previous execution data to determine current row
		const previousRunData = inputData?.[0]?.json;
		const previousRunRowNumber = previousRunData?.row_number;
		const previousRunRowsLeft = previousRunData?._rowsLeft;

		const credentials = await this.getCredentials('langwatchApi') as LangWatchCredentials;

		try {
			// Use static data to store the processed dataset and avoid re-shuffling
			const staticData = this.getWorkflowStaticData('node') as {
				processedDataset?: any[];
				datasetId?: string;
				shuffleRows?: boolean;
			};

			// Check if we need to reload the dataset (first run or different dataset)
			const needsReload = !staticData.processedDataset ||
				staticData.datasetId !== datasetId ||
				staticData.shuffleRows !== shuffleRows;

			let datasetEntries: any[];

			if (needsReload) {
				// Fetch the entire dataset from LangWatch API
				const response = await this.helpers.requestWithAuthentication.call(this, 'langwatchApi', {
					baseURL: credentials.host,
					method: 'GET',
					url: `/api/dataset/${datasetId}`,
				});

				const data = JSON.parse(response) as LangWatchDatasetResponse;
				datasetEntries = data.data || [];

				if (!Array.isArray(datasetEntries) || datasetEntries.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No rows found in dataset', {
						message: `Dataset '${datasetId}' is empty or doesn't exist. Check the dataset ID and ensure it contains data.`,
						description: 'Verify the dataset exists and has been populated with data.',
					});
				}

				// Apply shuffling only once when dataset is first loaded
				if (shuffleRows) {
					// Fisher-Yates shuffle algorithm
					for (let i = datasetEntries.length - 1; i > 0; i--) {
						const j = Math.floor(Math.random() * (i + 1));
						[datasetEntries[i], datasetEntries[j]] = [datasetEntries[j], datasetEntries[i]];
					}
				}

				// Store the processed dataset in static data
				staticData.processedDataset = datasetEntries;
				staticData.datasetId = datasetId;
				staticData.shuffleRows = shuffleRows;
			} else {
				// Use the cached dataset
				datasetEntries = staticData.processedDataset!;
			}

			// Apply start/end row filtering
			const startIndex = Math.max(0, startRow);
			const endIndex = endRow !== undefined ? Math.min(endRow + 1, datasetEntries.length) : datasetEntries.length;
			datasetEntries = datasetEntries.slice(startIndex, endIndex);

			// Apply step size filtering
			if (stepSize > 1) {
				datasetEntries = datasetEntries.filter((_, index) => index % stepSize === 0);
			}

			// Calculate current row index based on previous execution
			const currentIndex = typeof previousRunRowNumber === 'number' && previousRunRowsLeft !== 0
				? previousRunRowNumber + 1
				: 0;

			// Determine effective total rows
			const effectiveTotal = limitRows ? Math.min(maxRows, datasetEntries.length) : datasetEntries.length;

			// Check if we've processed all rows
			if (currentIndex >= effectiveTotal) {
				throw new NodeOperationError(this.getNode(), 'No row found', {
					message: 'All rows have been processed',
					description: `Processed ${effectiveTotal} rows from dataset '${datasetId}'. No more rows to process.`,
				});
			}

			// Get the current row
			const currentRowData = datasetEntries[currentIndex];
			const rowsLeft = Math.max(0, effectiveTotal - (currentIndex + 1));

			// Build the output data based on options
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
			};

			// Return the current row with enhanced data
			const currentRow: INodeExecutionData = {
				json: outputData,
			};

			return [[currentRow]];
		} catch (error) {
			if (error instanceof NodeOperationError) {
				throw error;
			}

			throw new NodeOperationError(this.getNode(), 'Failed to fetch dataset row', {
				message: `Error fetching row from dataset '${datasetId}': ${error.message}`,
				description: 'Check your dataset ID, API credentials, and network connection.',
			});
		}
	}
}
