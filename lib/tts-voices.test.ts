/**
 * Edge TTS voice catalogue and prosody contract tests.
 *
 * The catalogue is deliberately tiny (two hi-IN voices the service actually
 * serves). These tests pin the invariants the /api/tts wire contract and the
 * kitchen picker rely on: shape, uniqueness, integer prosody, SSML escaping.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDGE_VOICE,
  DEFAULT_PITCH,
  DEFAULT_VOLUME,
  EDGE_HINDI_VOICES,
  defaultPitchFor,
  escapeSsml,
  findEdgeVoice,
  normalizeProsodyHz,
  normalizeProsodyPercent,
  rateToProsody,
  toVoiceLike,
  voiceGender,
  voiceLabel,
} from './tts-voices';

describe('EDGE_HINDI_VOICES catalogue', () => {
  it('serves exactly one male and one female hi-IN voice — the complete Read Aloud offering', () => {
    expect(EDGE_HINDI_VOICES).toHaveLength(2);
    expect(new Set(EDGE_HINDI_VOICES.map((v) => v.name)).size).toBe(2);
    expect(EDGE_HINDI_VOICES.every((v) => v.lang === 'hi-IN')).toBe(true);
    const genders = EDGE_HINDI_VOICES.map((v) => v.gender).sort();
    expect(genders).toEqual(['Female', 'Male']);
  });

  it('every default voice exists and matches the default pitch rule', () => {
    const fallback = EDGE_HINDI_VOICES.find((v) => v.name === DEFAULT_EDGE_VOICE);
    expect(fallback).toBeDefined();
    expect(DEFAULT_PITCH).toBe(fallback!.pitch);
    expect(defaultPitchFor(DEFAULT_EDGE_VOICE)).toBe(DEFAULT_PITCH);
  });

  it('pitch values are valid [+-]\d+Hz strings, labels non-empty', () => {
    for (const voice of EDGE_HINDI_VOICES) {
      expect(voice.pitch).toMatch(/^[+-]\d+Hz$/);
      expect(voice.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_VOLUME is zero-change normal', () => {
    expect(DEFAULT_VOLUME).toBe('+0%');
  });
});

describe('findEdgeVoice / toVoiceLike / labels and gender', () => {
  it('round-trips catalogue voices and rejects unknown names', () => {
    expect(findEdgeVoice('hi-IN-MadhurNeural')?.gender).toBe('Male');
    expect(findEdgeVoice('hi-IN-SwaraNeural')?.gender).toBe('Female');
    expect(findEdgeVoice('nope')).toBeNull();
    expect(defaultPitchFor('nope')).toBe(DEFAULT_PITCH);
    expect(toVoiceLike(EDGE_HINDI_VOICES[0])).toMatchObject({ name: 'hi-IN-MadhurNeural', lang: 'hi-IN', localService: false });
  });

  it('voiceGender infers from catalogue first, then name hints, else null', () => {
    expect(voiceGender('hi-IN-MadhurNeural')).toBe('Male');
    expect(voiceGender('hi-IN-SwaraNeural')).toBe('Female');
    expect(voiceGender('Lekha')).toBe('Female');
    expect(voiceGender('Ravi')).toBe('Male');
    expect(voiceGender('zzzz-unknown')).toBeNull();
  });

  it('voiceLabel returns the catalogue label, or the raw name for device voices', () => {
    expect(voiceLabel('hi-IN-MadhurNeural')).toBe(EDGE_HINDI_VOICES[0].label);
    expect(voiceLabel('SomeDeviceVoice')).toBe('SomeDeviceVoice');
  });
});

describe('prosody formatting — integers only, per the wire contract', () => {
  it('rateToProsody produces signed integer percentages', () => {
    expect(rateToProsody(1)).toBe('+0%');
    expect(rateToProsody(0.92)).toBe('-8%');
    expect(rateToProsody(1.1)).toBe('+10%');
    expect(rateToProsody(0.9016)).toBe('-10%');
  });

  it('normalizeProsodyPercent is tolerant in, strict out', () => {
    expect(normalizeProsodyPercent('+0.00%', '+0%')).toBe('+0%');
    expect(normalizeProsodyPercent('-8%', '+0%')).toBe('-8%');
    expect(normalizeProsodyPercent('12%', '+0%')).toBe('+12%');
    expect(normalizeProsodyPercent(12, '+0%')).toBe('+12%');
    expect(normalizeProsodyPercent(999, '+0%')).toBe('+100%'); // clamped
    expect(normalizeProsodyPercent(-999, '+0%')).toBe('-100%');
    expect(normalizeProsodyPercent('garbage', '+3%')).toBe('+3%');
    expect(normalizeProsodyPercent(undefined, '+3%')).toBe('+3%');
    expect(normalizeProsodyPercent(NaN, '+3%')).toBe('+3%');
  });

  it('normalizeProsodyHz is tolerant in, strict out', () => {
    expect(normalizeProsodyHz('-4Hz', '+0Hz')).toBe('-4Hz');
    expect(normalizeProsodyHz('+10', '+0Hz')).toBe('+10Hz');
    expect(normalizeProsodyHz(-9, '+0Hz')).toBe('-9Hz');
    expect(normalizeProsodyHz(500, '+0Hz')).toBe('+100Hz'); // clamped
    expect(normalizeProsodyHz('junk', '+0Hz')).toBe('+0Hz');
  });
});

describe('escapeSsml', () => {
  it('escapes the five XML entities in &-first order (no double-escaping)', () => {
    expect(escapeSsml('Fish & Chips')).toBe('Fish &amp; Chips');
    expect(escapeSsml('<b>Dal</b>')).toBe('&lt;b&gt;Dal&lt;/b&gt;');
    expect(escapeSsml(`say "hi" & don't stop`)).toBe('say &quot;hi&quot; &amp; don&apos;t stop');
    expect(escapeSsml('&lt;already escaped&gt;')).toBe('&amp;lt;already escaped&amp;gt;');
  });
});
