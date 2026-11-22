/** Retry only idempotent B2 reads, including failures while consuming the body.
 * A new signed request is made on each attempt. Never log the response or URL.
 */
export async function readB2WithRetry(request, { attempts = 3, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('invalid retry limit');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await request();
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return { bytes, metadataSha256: response.headers.get('x-amz-meta-sha256') };
      }
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new B2HttpError(response.status);
      }
      if (attempt === attempts) throw new B2HttpError(response.status);
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (error instanceof B2HttpError || attempt === attempts) throw error;
    }
    await delay(attempt * 1000);
  }
  throw new Error('B2 read failed');
}

export class B2HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'B2HttpError';
    this.status = status;
  }
}
