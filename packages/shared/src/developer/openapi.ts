import { z } from 'zod';

import { codeSamples, type CodeSample } from './samples.js';
import {
  publicBatchSchema,
  publicContactPatchSchema,
  publicContactSchema,
  publicLookupSchema,
  publicMessageQuerySchema,
  publicSendSchema,
  webhookPatchSchema,
  webhookWriteSchema,
} from './schemas.js';

export interface OpenApiOperation {
  readonly method: 'get' | 'post' | 'patch' | 'delete';
  readonly path: string;
  readonly summary: string;
  readonly status: number;
  readonly body?: z.ZodType;
  readonly example?: unknown;
  readonly samples: CodeSample;
}

const OPERATIONS: readonly {
  method: OpenApiOperation['method'];
  path: string;
  summary: string;
  status: number;
  body?: z.ZodType;
  example?: unknown;
}[] = [
  {
    method: 'post',
    path: '/api/v1/messages',
    summary: 'Send one SMS',
    status: 202,
    body: publicSendSchema,
    example: { to: '+14155552671', text: 'Hello from SMSVIO' },
  },
  {
    method: 'post',
    path: '/api/v1/messages/batch',
    summary: 'Send up to 1,000 SMS messages',
    status: 200,
    body: publicBatchSchema,
    example: { messages: [{ to: '+14155552671', text: 'Hello' }] },
  },
  { method: 'get', path: '/api/v1/messages/{id}', summary: 'Retrieve one message', status: 200 },
  { method: 'get', path: '/api/v1/messages', summary: 'List messages', status: 200 },
  {
    method: 'post',
    path: '/api/v1/contacts',
    summary: 'Create a contact',
    status: 201,
    body: publicContactSchema,
    example: { phone: '+14155552671', name: 'Ada' },
  },
  { method: 'get', path: '/api/v1/contacts', summary: 'List contacts', status: 200 },
  { method: 'get', path: '/api/v1/contacts/{id}', summary: 'Retrieve one contact', status: 200 },
  {
    method: 'patch',
    path: '/api/v1/contacts/{id}',
    summary: 'Update a contact',
    status: 200,
    body: publicContactPatchSchema,
    example: { name: 'Ada Lovelace' },
  },
  { method: 'delete', path: '/api/v1/contacts/{id}', summary: 'Delete a contact', status: 200 },
  { method: 'get', path: '/api/v1/templates', summary: 'List templates', status: 200 },
  { method: 'get', path: '/api/v1/templates/{id}', summary: 'Retrieve one template', status: 200 },
  {
    method: 'get',
    path: '/api/v1/senders',
    summary: 'List approved senders and enabled countries',
    status: 200,
  },
  { method: 'get', path: '/api/v1/balance', summary: 'Read the prepaid balance', status: 200 },
  { method: 'get', path: '/api/v1/rates', summary: 'List prices per segment', status: 200 },
  {
    method: 'post',
    path: '/api/v1/lookup',
    summary: 'Look up a phone number',
    status: 200,
    body: publicLookupSchema,
    example: { phone: '+14155552671' },
  },
  {
    method: 'post',
    path: '/api/v1/webhooks',
    summary: 'Create a webhook endpoint',
    status: 201,
    body: webhookWriteSchema,
    example: {
      name: 'Production',
      url: 'https://example.com/smsvio',
      events: ['message.delivered'],
    },
  },
  { method: 'get', path: '/api/v1/webhooks', summary: 'List webhook endpoints', status: 200 },
  {
    method: 'get',
    path: '/api/v1/webhooks/{id}',
    summary: 'Retrieve one webhook endpoint',
    status: 200,
  },
  {
    method: 'patch',
    path: '/api/v1/webhooks/{id}',
    summary: 'Update a webhook endpoint',
    status: 200,
    body: webhookPatchSchema,
    example: { status: 'DISABLED' },
  },
  {
    method: 'delete',
    path: '/api/v1/webhooks/{id}',
    summary: 'Delete a webhook endpoint',
    status: 200,
  },
];

export function openApiOperations(): readonly OpenApiOperation[] {
  return OPERATIONS.map((operation) => ({
    ...operation,
    samples: codeSamples(
      operation.method,
      operation.path.replace('{id}', '00000000-0000-4000-8000-000000000000'),
      operation.example,
    ),
  }));
}

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of openApiOperations()) {
    const entry = paths[operation.path] ?? {};
    entry[operation.method] = {
      summary: operation.summary,
      operationId: `${operation.method}_${operation.path.replaceAll(/[^a-z0-9]+/gi, '_')}`,
      security: [{ apiKey: [] }],
      responses: {
        [String(operation.status)]: { description: operation.summary },
        '401': { description: 'The API key is missing or not valid.' },
      },
      ...(operation.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(operation.body),
                  example: operation.example,
                },
              },
            },
          }),
      ...(operation.path === '/api/v1/messages' && operation.method === 'get'
        ? { parameters: parameterSchema(publicMessageQuerySchema) }
        : {}),
    };
    paths[operation.path] = entry;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'SMSVIO API',
      version: '1.0.0',
      description:
        'Send SMS and receive signed webhooks. Authenticate with x-api-key or Authorization: Bearer.',
    },
    servers: [{ url: 'https://smsvio.com' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
    paths,
  };
}

export function parameterSchema(
  schema: z.ZodType,
): { name: string; in: 'query'; schema: unknown }[] {
  const properties = z.toJSONSchema(schema).properties;
  if (properties === undefined) {
    return [];
  }
  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: 'query' as const,
    schema: value,
  }));
}
