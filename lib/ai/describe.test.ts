import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gemini', () => ({
  callTextJson: vi.fn(),
  geminiConfigured: () => true,
}));
vi.mock('./groq', () => ({
  groqConfigured: () => true,
}));

import { callTextJson } from './gemini';
import { MAX_DESCRIPTION_LENGTH, generateDescriptions, type DescribeTarget } from './describe';

const call = vi.mocked(callTextJson);

const answer = (text: string) => Promise.resolve({ ok: true as const, model: 'test', text });

const targets: DescribeTarget[] = [
  { id: 'i-1', name: 'Paneer Tikka', category: 'Starters' },
  { id: 'i-2', name: 'Dal Makhani', category: 'Mains' },
];

beforeEach(() => {
  call.mockReset();
});

describe('generateDescriptions', () => {
  it('writes one description per dish, in order, with the ids kept', async () => {
    call.mockImplementationOnce(() =>
      answer(JSON.stringify({ items: ['Cottage cheese grilled on skewers.', 'Black lentils simmered overnight.'] }))
    );

    const results = await generateDescriptions(targets);

    expect(results).toEqual([
      { id: 'i-1', ok: true, description: 'Cottage cheese grilled on skewers.' },
      { id: 'i-2', ok: true, description: 'Black lentils simmered overnight.' },
    ]);
  });

  it('tells the model what it must never invent, and names every dish', async () => {
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: [null, null] })));

    await generateDescriptions(targets);

    const prompt = call.mock.calls[0][0].prompt;
    expect(prompt).toContain('Paneer Tikka');
    expect(prompt).toContain('(section: Starters)');
    expect(prompt).toContain('Dal Makhani');
    expect(prompt).toContain('Never invent ingredients');
    expect(prompt).toContain('exactly 2 entries');
  });

  it('reports a null answer as that dish failing — never a guessed description', async () => {
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: ['A short line.', null] })));

    const results = await generateDescriptions(targets);

    expect(results[0]).toMatchObject({ id: 'i-1', ok: true });
    expect(results[1]).toEqual({
      id: 'i-2',
      ok: false,
      reason: 'The writer had nothing honest to say for this one. Write it by hand.',
    });
  });

  it('treats a missing or non-string entry as a failure for that dish alone', async () => {
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: [42] })));

    const results = await generateDescriptions(targets);

    expect(results[0]).toMatchObject({ id: 'i-1', ok: false });
    expect(results[1]).toMatchObject({ id: 'i-2', ok: false });
  });

  it('fails every dish in the call when the answer is not JSON', async () => {
    call.mockImplementationOnce(() => answer('sorry, I cannot help with that'));

    const results = await generateDescriptions(targets);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: 'The writer returned something unreadable. Try again.' });
    }
  });

  it('passes the provider reason through when the whole call fails', async () => {
    call.mockImplementationOnce(() =>
      Promise.resolve({ ok: false as const, code: 'rate-limited' as const, reason: 'The writer is busy right now.' })
    );

    const results = await generateDescriptions(targets);

    expect(results[0]).toEqual({ id: 'i-1', ok: false, reason: 'The writer is busy right now.' });
    expect(results[1]).toEqual({ id: 'i-2', ok: false, reason: 'The writer is busy right now.' });
  });

  it('splits a long list into batches of ten and keeps every id', async () => {
    const many: DescribeTarget[] = Array.from({ length: 12 }, (_, index) => ({
      id: `i-${index}`,
      name: `Dish ${index}`,
      category: 'Mains',
    }));
    call.mockImplementation(() => answer(JSON.stringify({ items: Array(10).fill('One line.') })));

    const results = await generateDescriptions(many);

    expect(call).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(12);
    expect(results[11]).toMatchObject({ id: 'i-11', ok: true });
  });

  it('cleans whitespace and holds the shared length cap', async () => {
    const long = 'a'.repeat(400);
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: [`  ${long}  `, 'fine.'] })));

    const results = await generateDescriptions(targets);

    expect(results[0]).toMatchObject({ ok: true, description: 'a'.repeat(MAX_DESCRIPTION_LENGTH) });
  });

  it('fails an empty line rather than saving silence', async () => {
    call.mockImplementationOnce(() => answer(JSON.stringify({ items: ['   ', 'fine.'] })));

    const results = await generateDescriptions(targets);

    expect(results[0]).toMatchObject({ id: 'i-1', ok: false });
  });

  it('asks nothing of the model when there is nothing to write', async () => {
    expect(await generateDescriptions([])).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});
