/** Bounded JSON parsing for public APIs, including chunked bodies without a
 * Content-Length. Never buffer unbounded caller input before validating it. */
export class JsonInputError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

export async function readJsonObject(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) throw new JsonInputError('Request body is too large', 413);
  if (!request.body) throw new JsonInputError('Invalid JSON body', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new JsonInputError('Request body is too large', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new JsonInputError('Invalid JSON body', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JsonInputError('Expected a JSON object', 400);
  return value as Record<string, unknown>;
}
