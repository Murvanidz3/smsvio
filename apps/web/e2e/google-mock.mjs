import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../api/package.json'),
);
const { exportJWK, generateKeyPair, SignJWT } = require('jose');

const port = Number(process.env.GOOGLE_MOCK_PORT ?? 4099);
const issuer = `http://127.0.0.1:${String(port)}`;
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
jwk.kid = 'e2e';
jwk.alg = 'RS256';
jwk.use = 'sig';

const issued = new Map();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (url.pathname === '/authorize') {
    const state = url.searchParams.get('state') ?? 'state';
    const code = `code-${state.slice(0, 12)}`;
    issued.set(code, {
      email: `google-${state.slice(0, 10)}@smsvio.test`,
      sub: `sub-${state.slice(0, 12)}`,
      nonce: url.searchParams.get('nonce') ?? '',
      challenge: url.searchParams.get('code_challenge') ?? '',
    });
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? issuer);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', state);
    res.writeHead(302, { location: redirect.toString() }).end();
    return;
  }
  if (url.pathname === '/token') {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      void (async () => {
        const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const pending = issued.get(params.get('code') ?? '');
        const challenge = createHash('sha256')
          .update(params.get('code_verifier') ?? '')
          .digest('base64url');
        if (pending === undefined || challenge !== pending.challenge) {
          res.writeHead(400).end();
          return;
        }
        const idToken = await new SignJWT({
          email: pending.email,
          email_verified: true,
          name: 'Google User',
          nonce: pending.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
          .setIssuer(issuer)
          .setAudience('e2e-client')
          .setSubject(pending.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey);
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id_token: idToken }));
      })();
    });
    return;
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1');
