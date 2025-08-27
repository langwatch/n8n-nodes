import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LangWatchApi implements ICredentialType {
	name = 'langwatchApi';
	displayName = 'LangWatch API';

	documentationUrl = 'https://docs.langwatch.ai/';

	properties: INodeProperties[] = [
		{
			displayName: 'LangWatch Endpoint',
			name: 'host',
			type: 'string',
			default: 'https://app.langwatch.ai',
			description: 'The base URL for your LangWatch instance, defaults to the cloud instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your LangWatch API key',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				"X-Auth-Token": "={{ $credentials.apiKey }}", // legacy, but required on some endpoints still
				"Authorization": "Bearer {{$credentials.apiKey}}"
			}
		},
	};

	// The block below tells how this credential can be tested
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://example.com/',
			url: '',
		},
	};
}
