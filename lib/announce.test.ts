import { describe, expect, it } from 'vitest';
import {
  advanceText,
  createAnnounceQueue,
  MAX_SPOKEN_ITEMS,
  newOrderText,
  summariseItems,
  type Speaker,
} from './announce';

/**
 * The queue exists because a kitchen takes several orders at once.
 *
 * These tests are mostly about that case: four tables ordering in the same
 * second must produce four complete announcements, in order, with nothing
 * cancelled mid-word. The previous implementation called
 * speechSynthesis.cancel() before each utterance, which meant three of those
 * four were cut off and the kitchen heard a sentence fragment.
 */

/**
 * A speaker that holds each utterance open until told to finish, so the test
 * can decide when one announcement ends and prove the next has not started.
 */
function controllable() {
  const spoken: string[] = [];
  let finishCurrent: (() => void) | null = null;
  let started = 0;

  const speaker: Speaker = {
    speak(text, onEnd) {
      started += 1;
      spoken.push(text);
      finishCurrent = onEnd;
    },
  };

  return {
    speaker,
    spoken,
    get started() {
      return started;
    },
    finish() {
      const done = finishCurrent;
      finishCurrent = null;
      done?.();
    },
  };
}

/** A speaker that finishes immediately, for the simple cases. */
function immediate() {
  const spoken: string[] = [];
  const speaker: Speaker = {
    speak(text, onEnd) {
      spoken.push(text);
      onEnd();
    },
  };
  return { speaker, spoken };
}

describe('createAnnounceQueue', () => {
  it('speaks one announcement at a time', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('a', 'first');
    queue.push('b', 'second');

    // Only the first has been handed to the speaker.
    expect(ctl.spoken).toEqual(['first']);
    expect(queue.pending()).toBe(1);
    expect(queue.speaking()).toBe(true);

    ctl.finish();

    // Finishing the first starts the second, which is the queue working --
    // it does not go idle while anything is still waiting.
    expect(ctl.spoken).toEqual(['first', 'second']);
    expect(queue.pending()).toBe(0);
    expect(queue.speaking()).toBe(true);

    ctl.finish();
    expect(queue.speaking()).toBe(false);
  });

  it('gets through all four when four tables order at once', () => {
    // The case that was broken: a burst where nothing may be dropped or cut
    // off, and every sentence must be spoken whole.
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('o1', 'New order for T1.');
    queue.push('o2', 'New order for T2.');
    queue.push('o3', 'New order for T3.');
    queue.push('o4', 'New order for T4.');

    expect(queue.pending()).toBe(3);

    ctl.finish();
    ctl.finish();
    ctl.finish();
    ctl.finish();

    expect(ctl.spoken).toEqual([
      'New order for T1.',
      'New order for T2.',
      'New order for T3.',
      'New order for T4.',
    ]);
    expect(queue.pending()).toBe(0);
  });

  it('keeps them in the order they arrived', () => {
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    for (const n of [5, 1, 9, 3, 7]) queue.push(`o${n}`, `order ${n}`);

    expect(spoken).toEqual(['order 5', 'order 1', 'order 9', 'order 3', 'order 7']);
  });

  it('does not announce the same key twice', () => {
    // The board re-reads every few seconds. Without this it would repeat
    // every open ticket on every poll and never stop talking.
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    expect(queue.push('o1', 'first time')).toBe(true);
    expect(queue.push('o1', 'first time')).toBe(false);
    expect(queue.push('o1', 'first time')).toBe(false);

    expect(spoken).toEqual(['first time']);
    expect(queue.has('o1')).toBe(true);
  });

  it('does not queue a duplicate that is still waiting', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('o1', 'one');
    queue.push('o2', 'two');
    queue.push('o2', 'two'); // second poll, before 'two' has been spoken

    expect(queue.pending()).toBe(1);
    ctl.finish();
    ctl.finish();

    expect(ctl.spoken).toEqual(['one', 'two']);
  });

  it('announces again once a key is forgotten', () => {
    // Replay is a button on the board, and it has to work after the order
    // has already been announced once.
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    queue.push('o1', 'once');
    queue.forget('o1');
    queue.push('o1', 'twice');

    expect(spoken).toEqual(['once', 'twice']);
  });

  it('keeps working after a speaker throws', () => {
    // A speaker that throws must not wedge the queue. Silent failure here
    // looks exactly like the kitchen turning audio off.
    const spoken: string[] = [];
    let calls = 0;

    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        calls += 1;
        spoken.push(text);
        onEnd();
        if (calls === 1) throw new Error('audio device gone');
      },
    });

    // The throw is swallowed: the queue's job is to keep talking, and a
    // broken audio device on one announcement must not end the service.
    expect(() => queue.push('o1', 'first')).not.toThrow();
    queue.push('o2', 'second');

    expect(spoken).toEqual(['first', 'second']);
    expect(queue.pending()).toBe(0);
    expect(queue.speaking()).toBe(false);
  });
});

describe('newOrderText', () => {
  it('leads with the table and lists the dishes', () => {
    const text = newOrderText('T1', [
      { qty: 2, name: 'Butter Chicken' },
      { qty: 1, name: 'normal rice' },
    ]);
    expect(text).toBe('New order for T1. 2 Butter Chicken, 1 normal rice.');
  });

  it('never mentions the order code', () => {
    // The pass carries plates to a table, not to a code. A code belongs on a
    // receipt, and a kitchen asked to remember one gets it wrong.
    const text = newOrderText('T1', [{ qty: 1, name: 'koko' }]);
    expect(text).not.toMatch(/MA-|code|[A-Z]{2}-[A-Z0-9]{5}/);
  });

  it('says something useful for an order with no lines', () => {
    expect(newOrderText('T1', [])).toBe('New order for T1.');
  });
});

describe('advanceText', () => {
  it('names the table and the new state', () => {
    expect(advanceText('T1', 'ready')).toBe('T1, ready.');
  });
});

describe('summariseItems', () => {
  it('leaves a short order alone', () => {
    const items = [
      { qty: 1, name: 'a' },
      { qty: 2, name: 'b' },
    ];
    expect(summariseItems(items)).toEqual(items);
  });

  it('counts the remainder instead of reading a long order in full', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ qty: 1, name: `dish${i}` }));
    const out = summariseItems(items);

    expect(out).toHaveLength(MAX_SPOKEN_ITEMS + 1);
    expect(out.at(-1)).toEqual({ qty: 5, name: 'more items' });
  });
});
