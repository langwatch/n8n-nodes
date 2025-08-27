import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	INodePropertyOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { getLangWatchTracer, LangWatch } from 'langwatch';
import { getWorkflowExecutionContext } from '../../shared/otel';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';

interface VariableMapping {
	name: string;
	value: string;
}

interface InputDataVariableMapping {
	name: string;
	dataPath: string;
}

interface VariablesCollection {
	variables?: VariableMapping[];
}

interface InputDataVariablesCollection {
	variables?: InputDataVariableMapping[];
}

type TemplateVariables = Record<string, any>;

export class LangWatchPrompt implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LangWatch Prompt',
		name: 'langWatchPrompt',
		icon: 'file:logo.svg',
		group: ['transform'],
		version: 1,
		description:
			'Retrieve and compile a prompt from the LangWatch Prompt Manager using the TypeScript SDK',
		defaults: {
			name: 'LangWatch Prompt',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		hints: [
			{
				message:
					'Enable <b>Compile Prompt</b> to use template variables and get the final prompt ready for use. This is recommended for most use cases.',
				type: 'info',
				location: 'inputPane',
				whenToDisplay: 'always',
				displayCondition: '={{ !$parameter["compile"] }}',
			},
			{
				message:
					"Great! You've enabled compilation. Make sure to provide the required template variables to compile the prompt successfully.",
				type: 'info',
				location: 'inputPane',
				whenToDisplay: 'always',
				displayCondition: '={{ $parameter["compile"] }}',
			},
			{
				message:
					"When compilation is enabled, you'll get two outputs: the original prompt and the compiled prompt ready for use.",
				type: 'info',
				location: 'outputPane',
				whenToDisplay: 'always',
				displayCondition: '={{ $parameter["compile"] }}',
			},
		],

		credentials: [
			{
				name: 'langwatchApi',
				required: true,
			},
		],

		properties: [
			{
				displayName: 'Prompt Selection Method',
				name: 'promptSelectionMethod',
				type: 'options',
				options: [
					{
						name: 'Manual Input',
						value: 'manual',
						description: 'Manually enter the prompt handle or ID',
					},
					{
						name: 'Select From Dropdown',
						value: 'dropdown',
						description: 'Select a prompt from a list fetched from LangWatch',
					},
				],
				default: 'manual',
				description: 'Choose how to specify the prompt',
			},
			{
				displayName: 'Prompt Handle or ID',
				name: 'handleOrId',
				type: 'string',
				required: true,
				default: '',
				description: 'The handle or ID of the prompt to retrieve',
				placeholder: 'my-prompt or prompt-ID',
				displayOptions: {
					show: {
						promptSelectionMethod: ['manual'],
					},
				},
			},
			{
				displayName: 'Prompt Name or ID',
				name: 'promptId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getPrompts',
				},
				required: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: {
						promptSelectionMethod: ['dropdown'],
					},
				},
			},
			{
				displayName: 'Version Selection',
				name: 'versionSelection',
				type: 'options',
				options: [
					{
						name: 'Latest Version',
						value: 'latest',
						description: 'Use the most recent version of the prompt',
					},
					{
						name: 'Specific Version',
						value: 'specific',
						description: 'Specify a particular version to use',
					},
				],
				default: 'latest',
				description: 'Choose which version of the prompt to retrieve',
			},
			{
				displayName: 'Version',
				name: 'version',
				type: 'string',
				default: '',
				description: 'The specific version of the prompt to retrieve',
				placeholder: 'v1.2.3',
				displayOptions: {
					show: {
						versionSelection: ['specific'],
					},
				},
			},
			{
				displayName: 'Compile Prompt',
				name: 'compile',
				type: 'boolean',
				default: false,
				description: 'Whether to compile the prompt template with variables',
				hint: 'Enable this to use template variables and get the final prompt ready for use. This is recommended for most use cases.',
			},
			{
				displayName: 'Variable Source',
				name: 'variableSource',
				type: 'options',
				options: [
					{
						name: 'Manual',
						value: 'manual',
						description: 'Manually specify variables',
					},
					{
						name: 'From Input Data',
						value: 'inputData',
						description: 'Use data from input items as variables',
					},
					{
						name: 'Mixed',
						value: 'mixed',
						description: 'Combine manual variables with input data',
					},
				],
				default: 'manual',
				hint: 'Choose how to provide template variables. "From Input Data" is useful when you want to use data from previous nodes.',
				displayOptions: {
					show: {
						compile: [true],
					},
				},
			},
			{
				displayName: 'Template Variables',
				name: 'variables',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						compile: [true],
						variableSource: ['manual', 'mixed'],
					},
				},
				default: {},
				placeholder: 'Add variable',
				options: [
					{
						name: 'variables',
						displayName: 'Variables',
						values: [
							{
								displayName: 'Variable Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'user_name',
								description: 'Name of the template variable',
							},
							{
								displayName: 'Variable Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'John Doe',
								description: 'Value for the template variable (supports expressions)',
							},
						],
					},
				],
			},
			{
				displayName: 'Input Data Variables',
				name: 'inputDataVariables',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						compile: [true],
						variableSource: ['inputData', 'mixed'],
					},
				},
				default: {},
				placeholder: 'Add variable mapping',
				options: [
					{
						name: 'variables',
						displayName: 'Variable Mappings',
						values: [
							{
								displayName: 'Variable Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'user_name',
								description: 'Name of the template variable',
							},
							{
								displayName: 'Data Path',
								name: 'dataPath',
								type: 'string',
								default: '',
								placeholder: '{{ $json.user.name }}',
								description: 'Expression to extract data from input items',
							},
						],
					},
				],
			},
			{
				displayName: 'Strict Compilation',
				name: 'strict',
				type: 'boolean',
				default: false,
				description:
					'Whether to use strict compilation (throws error if required variables are missing)',
				displayOptions: {
					show: {
						compile: [true],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async getPrompts(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials('langwatchApi')) as {
					host: string;
					apiKey: string;
				};

				const langwatch = new LangWatch({
					apiKey: credentials.apiKey,
					endpoint: credentials.host,
				});

				const prompts = await langwatch.prompts.getAll();
				return prompts.map((prompt) => ({
					name: prompt.name || prompt.handle || prompt.id,
					value: prompt.id,
					description: prompt.handle ? `Handle: ${prompt.handle}` : `ID: ${prompt.id}`,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const promptSelectionMethod = this.getNodeParameter('promptSelectionMethod', 0, 'manual') as string;
		const handleOrId = this.getNodeParameter('handleOrId', 0, '') as string;
		const promptId = this.getNodeParameter('promptId', 0, '') as string;
		const versionSelection = this.getNodeParameter('versionSelection', 0, 'latest') as string;
		const version = this.getNodeParameter('version', 0, '') as string;
		const compile = this.getNodeParameter('compile', 0, false) as boolean;
		const strict = this.getNodeParameter('strict', 0, false) as boolean;
		const variableSource = this.getNodeParameter('variableSource', 0, 'manual') as string;

		// Determine the prompt identifier based on selection method
		const finalPromptId = promptSelectionMethod === 'dropdown' ? promptId : handleOrId;

		// Determine version options based on selection
		const versionOptions = versionSelection === 'specific' && version ? { version } : undefined;

		const tracer = getLangWatchTracer('langwatch.n8n.prompts');
		const credentials = (await this.getCredentials('langwatchApi')) as {
			host: string;
			apiKey: string;
		};
		const { withContext } = getWorkflowExecutionContext(this);

		const langwatch = new LangWatch({
			apiKey: credentials.apiKey,
			endpoint: credentials.host,
		});

		return await withContext(async () => {
			const span = tracer.startSpan('n8n:LangWatch Prompt Node');
			try {
				return await context.with(trace.setSpan(context.active(), span), async () => {
					try {
						// Fetch the prompt using the SDK
						const prompt = await langwatch.prompts.get(finalPromptId, versionOptions);
						if (!prompt) {
							throw new NodeOperationError(
								this.getNode(),
								`Prompt with handle or ID '${finalPromptId}' not found`,
							);
						}

						const outputData: IDataObject = {
							compiledPrompt: void 0, // So that it's at the top in the UI if present.
							prompt: {
								...prompt,

								// Wipe this as it's a duplicate
								promptData: void 0,
							},
						};

						if (compile) {
							const variables = collectVariables(this, variableSource);

							try {
								const compiledPrompt = strict
									? prompt.compileStrict(variables)
									: prompt.compile(variables);

								outputData.compiledPrompt = {
									...compiledPrompt,

									// Wipe these as we persist at the root
									promptData: void 0,
									original: void 0,
								};
							} catch (compilationError) {
								if (compilationError instanceof Error) {
									throw new NodeOperationError(
										this.getNode(),
										`Failed to compile prompt: ${compilationError.message}`,
									);
								}
								throw compilationError;
							}
						}

						return [[{ json: outputData }]];
					} catch (error) {
						if (error instanceof Error) {
							throw new NodeOperationError(
								this.getNode(),
								`LangWatch Prompt error: ${error.message}`,
							);
						}
						throw error;
					}
				});
			} catch (error) {
				span.recordException(error);
				span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

				throw error;
			} finally {
				span.end();
			}
		});
	}
}

function collectManualVariables(executeFunctions: IExecuteFunctions): TemplateVariables {
	const variables: TemplateVariables = {};
	const variablesCollection = executeFunctions.getNodeParameter(
		'variables',
		0,
		{},
	) as VariablesCollection;

	if (variablesCollection.variables) {
		for (const variable of variablesCollection.variables) {
			variables[variable.name] = variable.value;
		}
	}

	return variables;
}

function collectInputDataVariables(executeFunctions: IExecuteFunctions): TemplateVariables {
	const variables: TemplateVariables = {};
	const inputDataVariablesCollection = executeFunctions.getNodeParameter(
		'inputDataVariables',
		0,
		{},
	) as InputDataVariablesCollection;

	if (inputDataVariablesCollection.variables) {
		for (const variable of inputDataVariablesCollection.variables) {
			variables[variable.name] = variable.dataPath;
		}
	}

	return variables;
}

function collectAllInputDataVariables(executeFunctions: IExecuteFunctions): TemplateVariables {
	const items = executeFunctions.getInputData();
	if (items.length > 0) {
		return { ...items[0].json };
	}
	return {};
}

function collectVariables(
	executeFunctions: IExecuteFunctions,
	variableSource: string,
): TemplateVariables {
	const variables: TemplateVariables = {};

	// Add manual variables if specified
	if (variableSource === 'manual' || variableSource === 'mixed') {
		Object.assign(variables, collectManualVariables(executeFunctions));
	}

	// Add input data variables if specified
	if (variableSource === 'inputData' || variableSource === 'mixed') {
		const inputDataVariables = collectInputDataVariables(executeFunctions);

		// If using input data source and no specific mappings, use all input data
		if (variableSource === 'inputData' && Object.keys(inputDataVariables).length === 0) {
			Object.assign(variables, collectAllInputDataVariables(executeFunctions));
		} else {
			Object.assign(variables, inputDataVariables);
		}
	}

	return variables;
}
