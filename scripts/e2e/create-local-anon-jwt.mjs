import { createHmac } from 'node:crypto';

const secret = process.env.LOCAL_E2E_JWT_SECRET;
if (!secret || Buffer.byteLength(secret) < 32) {
  throw new Error('LOCAL_E2E_JWT_SECRET must be at least 32 bytes and must be test-only.');
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({ role: 'anon', iss: 'autodine-local-e2e', iat: now, exp: now + 2 * 60 * 60 });
const unsigned = `${header}.${payload}`;
const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
process.stdout.write(`${unsigned}.${signature}`);
