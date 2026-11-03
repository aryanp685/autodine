import { describe, expect, it } from 'vitest';
import { draftToRow, rowToDraft, sanitiseBrandDraft, MAX_NAME } from './draft';

// A helper name kept out of the module: build a valid draft object to mutate.
function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    importId: '11111111-2222-4333-8444-555555555555',
    name: 'Punjabi Rasoi',
    nameConfirmed: true,
    theme: {
      colors: { primary: '#7a1f2b' },
      typography: { character: 'serif' },
      layout: { header: 'plain', motifs: ['rule-double'] },
    },
    logoAssetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    bannerAssetId: null,
    provenance: { name: 'owner-confirmed', primary: 'owner-confirmed' },
    conflicts: [{ field: 'name', message: 'two names', options: [{ label: 'a', value: 'A' }] }],
    notes: ['the mark looked decorative'],
    ...overrides,
  };
}

describe('sanitiseBrandDraft', () => {
  it('accepts a well-formed draft and keeps its shape', () => {
    const draft = sanitiseBrandDraft(validDraft());
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe('Punjabi Rasoi');
    expect(draft!.theme.colors.primary).toBe('#7a1f2b');
    expect(draft!.conflicts).toHaveLength(1);
  });

  it('refuses anything without a valid theme or import id', () => {
    expect(sanitiseBrandDraft(null)).toBeNull();
    expect(sanitiseBrandDraft(validDraft({ theme: { colors: { primary: 'red' } } }))).toBeNull();
    expect(sanitiseBrandDraft(validDraft({ importId: 'not-a-uuid' }))).toBeNull();
    expect(sanitiseBrandDraft(validDraft({ importId: null }))).toBeNull();
  });

  it('drops ids that are not uuids and text that is not text', () => {
    const draft = sanitiseBrandDraft(
      validDraft({ logoAssetId: '../../etc/passwd', name: 42, notes: ['ok', 7, null] }),
    );
    expect(draft!.logoAssetId).toBeNull();
    expect(draft!.name).toBeNull();
    expect(draft!.notes).toEqual(['ok']);
  });

  it('caps names, notes and conflicts', () => {
    const draft = sanitiseBrandDraft(
      validDraft({
        name: 'x'.repeat(500),
        notes: Array.from({ length: 20 }, (_, i) => `note ${i}`),
        conflicts: Array.from({ length: 20 }, () => ({ field: 'name', message: 'm', options: [] })),
      }),
    );
    expect(draft!.name!.length).toBeLessThanOrEqual(MAX_NAME);
    expect(draft!.notes.length).toBe(6);
    expect(draft!.conflicts.length).toBe(8);
  });

  it('keeps only known provenance sources and conflict fields', () => {
    const draft = sanitiseBrandDraft(
      validDraft({
        provenance: { name: 'telepathy', primary: 'printed-menu', evil: 'x' },
        conflicts: [{ field: 'mood', message: 'vibes', options: [] }],
      }),
    );
    expect(draft!.provenance).toEqual({ primary: 'printed-menu' });
    expect(draft!.conflicts).toEqual([]);
  });
});

describe('draft ↔ row round trip', () => {
  it('survives a save and load unchanged', () => {
    const draft = sanitiseBrandDraft(validDraft())!;
    const row = draftToRow(draft);
    const back = rowToDraft({
      import_id: draft.importId,
      name: draft.name,
      theme: row.theme,
      source: row.source,
      logo_asset_id: draft.logoAssetId,
      banner_asset_id: draft.bannerAssetId,
    });
    expect(back).toEqual(draft);
  });

  it('a junk theme in the row loads as null rather than a broken draft', () => {
    expect(
      rowToDraft({ import_id: 'u', name: null, theme: { nope: true }, source: {}, logo_asset_id: null, banner_asset_id: null }),
    ).toBeNull();
  });
});
