export interface CodeSample {
  readonly curl: string;
  readonly node: string;
  readonly python: string;
  readonly php: string;
}

export function codeSamples(method: string, path: string, body: unknown): CodeSample {
  const verb = method.toUpperCase();
  const payload = body === undefined ? '' : JSON.stringify(body, null, 2);
  const curlBody = payload === '' ? '' : ` \\\n  -d '${payload.replaceAll("'", "'\\''")}'`;
  const curl = `curl -X ${verb} https://smsvio.com${path} \\\n  -H 'x-api-key: svk_live_…' \\\n  -H 'content-type: application/json'${curlBody}`;
  const node =
    payload === ''
      ? `const response = await fetch('https://smsvio.com${path}', {\n  method: '${verb}',\n  headers: { 'x-api-key': process.env.SMSVIO_API_KEY ?? '' },\n});\nconsole.log(await response.json());`
      : `const response = await fetch('https://smsvio.com${path}', {\n  method: '${verb}',\n  headers: {\n    'x-api-key': process.env.SMSVIO_API_KEY ?? '',\n    'content-type': 'application/json',\n  },\n  body: JSON.stringify(${payload}),\n});\nconsole.log(await response.json());`;
  const python =
    payload === ''
      ? `import os, requests\nresponse = requests.${verb.toLowerCase()}(\n    'https://smsvio.com${path}',\n    headers={'x-api-key': os.environ['SMSVIO_API_KEY']},\n)\nprint(response.json())`
      : `import os, requests\nresponse = requests.${verb.toLowerCase()}(\n    'https://smsvio.com${path}',\n    headers={'x-api-key': os.environ['SMSVIO_API_KEY']},\n    json=${payload},\n)\nprint(response.json())`;
  const phpBody =
    payload === '' ? '' : `    CURLOPT_POSTFIELDS => '${payload.replaceAll("'", "\\'")}',\n`;
  const php = `<?php\n$ch = curl_init('https://smsvio.com${path}');\ncurl_setopt_array($ch, [\n    CURLOPT_CUSTOMREQUEST => '${verb}',\n    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('SMSVIO_API_KEY'), 'content-type: application/json'],\n${phpBody}    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);\n`;
  return { curl, node, python, php };
}

export const WEBHOOK_SIGNATURE_GUIDE = [
  'SMSVIO signs webhooks with the Standard Webhooks scheme.',
  'Read the raw request body before parsing JSON.',
  'The signed content is webhook-id, webhook-timestamp, and the raw body, joined with periods.',
  'The secret is the base64 value after the whsec_ prefix.',
  'Compute HMAC-SHA256 and compare it with the v1 signature in webhook-signature.',
  'Reject timestamps more than five minutes from the current time.',
].join(' ');
