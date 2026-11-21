import { describe, expect, it } from 'vitest';
import { readJsonObject, JsonInputError } from './http-json';
const post = (body: string) => new Request('http://localhost/api', { method: 'POST', body });
describe('bounded JSON input', () => {
  it('accepts an object and preserves Unicode', async () => {
    expect(await readJsonObject(post('{"text":"नमस्ते"}'))).toEqual({ text: 'नमस्ते' });
  });
  it.each(['null', '[]', '42', '"a"', '{'])('rejects non-object or malformed JSON: %s', async body => {
    await expect(readJsonObject(post(body))).rejects.toBeInstanceOf(JsonInputError);
  });
  it('bounds a body without Content-Length', async () => {
    await expect(readJsonObject(post('{"text":"' + 'x'.repeat(9000) + '"}'))).rejects.toMatchObject({ status: 413 });
  });
});
