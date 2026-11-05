import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gemini', () => ({
  callTextJson: vi.fn(),
  geminiConfigured: () => true,
}));
vi.mock('./groq', () => ({
  groqConfigured: () => true,
}));

import { callTextJson } from './gemini';
import {
  MAX_TRANSLATED_DESCRIPTION,
  MAX_TRANSLATED_NAME,
  translateBatch,
  type TranslateTarget,
} from './translate';

const call = vi.mocked(callTextJson);

const answer = (text: string) => Promise.resolve({ ok: true as const, model: 'test', text });

const targets: TranslateTarget[] = [
  { id: 'i-1', name: 'Paneer Tikka', description: 'Cottage cheese on skewers.' },
  { id: 'i-2', name: 'Dal Makhani', description: '' },
];

beforeEach(() => {
  call.mockReset();
});

describe('translateBatch', () => {
  it('translates names and descriptions in order, ids kept', async () => {
    call.mockImplementationOnce(() =>
      answer(
        JSON.stringify({
          items: [
            { name: 'पनीर टिक्का', description: 'स्क्यूअर पर ग्रील्ड पनीर।' },
            { name: 'दाल मखनी', description: '' },
          ],
        })
      )
    );

    const results = await translateBatch(targets, 'hi');

    expect(results).toEqual([
      { id: 'i-1', ok: true, name: 'पनीर टिक्का', description: 'स्क्यूअर पर ग्रील्ड पनीर।' },
      { id: 'i-2', ok: true, name: 'दाल मखनी', description: '' },
    ]);
  });

  it('names the target language and forbids invention in the prompt', async () => {
    call.mockImplementationOnce(() =>
      answer(JSON.stringify({ items: [null, null] }))
    );

    await translateBatch(targets, 'mr');

    const prompt = call.mock.calls[0][0].prompt;
    expect(prompt).toContain('Marathi (Devanagari script)');
    expect(prompt).toContain('add nothing, drop nothing');
    expect(prompt).toContain('Never invent ingredients');
    expect(prompt).toContain('exactly 2 entries');
    expect(prompt).toContain('Paneer Tikka');
  });

  it('reports a null answer as that row failing — never source text posing as translation', async () => {
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: [{ name: 'पनीर टिक्का', description: '' }, null] })));

    const results = await translateBatch(targets, 'hi');

    expect(results[0]).toMatchObject({ id: 'i-1', ok: true });
    expect(results[1]).toEqual({
      id: 'i-2',
      ok: false,
      reason: 'The translator could not translate this one faithfully. Edit it by hand.',
    });
  });

  it('fails a row whose answer lacks a name, alone', async () => {
    call.mockImplementationOnce(() =>
      answer(JSON.stringify({ items: [{ description: 'कुछ' }, { name: 'दाल मखनी', description: '' }] }))
    );

    const results = await translateBatch(targets, 'hi');

    expect(results[0]).toMatchObject({ id: 'i-1', ok: false });
    expect(results[1]).toMatchObject({ id: 'i-2', ok: true });
  });

  it('fails every row in the call when the answer is not JSON', async () => {
    call.mockImplementationOnce(() => answer('not json at all'));

    const results = await translateBatch(targets, 'hi');

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: 'The translator returned something unreadable. Try again.' });
    }
  });

  it('passes the provider reason through when the whole call fails', async () => {
    call.mockImplementationOnce(() =>
      Promise.resolve({ ok: false as const, code: 'rate-limited' as const, reason: 'The translator is busy right now.' })
    );

    const results = await translateBatch(targets, 'hi');

    expect(results[0]).toEqual({ id: 'i-1', ok: false, reason: 'The translator is busy right now.' });
  });

  it('splits a long list into batches of ten and keeps every id', async () => {
    const many: TranslateTarget[] = Array.from({ length: 12 }, (_, index) => ({
      id: `i-${index}`,
      name: `Dish ${index}`,
      description: '',
    }));
    call.mockImplementation(() =>
      answer(JSON.stringify({ items: Array(10).fill({ name: 'नाम', description: '' }) }))
    );

    const results = await translateBatch(many, 'hi');

    expect(call).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(12);
    expect(results[11]).toMatchObject({ id: 'i-11', ok: true });
  });

  it('holds the shared name and description caps', async () => {
    call.mockImplementationOnce(() =>
      answer(
        JSON.stringify({
          items: [
            { name: 'a'.repeat(200), description: 'b'.repeat(400) },
            { name: 'ठीक', description: '' },
          ],
        })
      )
    );

    const results = await translateBatch(targets, 'hi');

    expect(results[0]).toMatchObject({
      ok: true,
      name: 'a'.repeat(MAX_TRANSLATED_NAME),
      description: 'b'.repeat(MAX_TRANSLATED_DESCRIPTION),
    });
  });

  it('asks nothing when there is nothing to translate', async () => {
    expect(await translateBatch([], 'hi')).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});
