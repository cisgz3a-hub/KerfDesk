import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintGcode } from '../../../core/recovery';
import type { LaserSecondPassStroke } from '../../../core/laser-second-pass';
import { loadSecondPassDraft, saveSecondPassDraft } from './second-pass-draft';

const KEY = 'kerfdesk.second-pass-drafts.v2';
const LEGACY_KEY = 'kerfdesk.second-pass-draft.v1';
const A = { runId: 'job-a', fingerprint: fingerprintGcode('G1 X10 F100 S100\n') };
const B = { runId: 'job-b', fingerprint: fingerprintGcode('G1 X20 F100 S100\n') };

function strokes(id: string): ReadonlyArray<LaserSecondPassStroke> {
  return [{ id, mode: 'paint', radiusMm: 2, powerScale: 1.5, points: [{ x: 12.5, y: -3 }] }];
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('painted drafts owned by their exact saved source', () => {
  it('keeps only the draft of the job saved last', () => {
    expect(saveSecondPassDraft(A, strokes('a'))).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a'));
    expect(saveSecondPassDraft(A, strokes('a-edited'))).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a-edited'));
    expect(saveSecondPassDraft(B, strokes('b'))).toBe(true);
    expect(loadSecondPassDraft(B)).toEqual(strokes('b'));
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect((JSON.parse(localStorage.getItem(KEY)!) as { drafts: unknown[] }).drafts).toHaveLength(
      1,
    );
  });

  it('matches run ID and every fingerprint field, independent of object property order', () => {
    expect(saveSecondPassDraft(A, strokes('a'))).toBe(true);
    expect(loadSecondPassDraft({ ...A, runId: 'different-run' })).toEqual([]);
    for (const field of ['fnv1a', 'chars', 'lines'] as const) {
      expect(
        loadSecondPassDraft({
          ...A,
          fingerprint: { ...A.fingerprint, [field]: A.fingerprint[field] + 1 },
        }),
      ).toEqual([]);
    }
    expect(
      loadSecondPassDraft({
        runId: A.runId,
        fingerprint: {
          lines: A.fingerprint.lines,
          chars: A.fingerprint.chars,
          fnv1a: A.fingerprint.fnv1a,
        },
      }),
    ).toEqual(strokes('a'));
    const revised = { ...A, fingerprint: B.fingerprint };
    expect(saveSecondPassDraft(revised, strokes('revised-a'))).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect(loadSecondPassDraft(revised)).toEqual(strokes('revised-a'));
  });

  it('reads the 20 drafts an older build kept, then trims them to the job saved next', () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({ ...A, runId: `job-${index}` }));
    const drafts = sources.map((source) => ({ ...source, strokes: strokes(source.runId) }));
    localStorage.setItem(KEY, JSON.stringify({ version: 2, drafts }));
    for (const source of sources)
      expect(loadSecondPassDraft(source)).toEqual(strokes(source.runId));
    expect(saveSecondPassDraft(sources[3]!, strokes('edited'))).toBe(true);
    expect(loadSecondPassDraft(sources[3]!)).toEqual(strokes('edited'));
    expect(loadSecondPassDraft(sources[19]!)).toEqual([]);
    expect((JSON.parse(localStorage.getItem(KEY)!) as { drafts: unknown[] }).drafts).toHaveLength(
      1,
    );
  });

  it('reads legacy data without writing, then replaces it with the next successful save', () => {
    const legacy = JSON.stringify({
      ...A,
      fingerprint: JSON.stringify(A.fingerprint),
      strokes: strokes('legacy-a'),
    });
    localStorage.setItem(LEGACY_KEY, legacy);
    expect(loadSecondPassDraft(A)).toEqual(strokes('legacy-a'));
    expect(loadSecondPassDraft(B)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(saveSecondPassDraft(B, strokes('new-b'))).toBe(true);
    expect(loadSecondPassDraft(B)).toEqual(strokes('new-b'));
    // The saved envelope is authoritative: the legacy draft does not reappear.
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy);
    expect(saveSecondPassDraft(A, [])).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual([]);
  });
});

describe('painted draft write failure', () => {
  it('keeps the saved draft and reports quota failure when an update cannot be committed', () => {
    saveSecondPassDraft(A, strokes('a'));
    const previous = localStorage.getItem(KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(saveSecondPassDraft(A, strokes('unsaved-a'))).toBe(false);
    expect(saveSecondPassDraft(B, strokes('unsaved-b'))).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(previous);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a'));
    expect(loadSecondPassDraft(B)).toEqual([]);
  });

  it.each([
    '{broken',
    JSON.stringify({ version: 3, drafts: [] }),
    JSON.stringify({ version: 2, drafts: [{ runId: 'a', strokes: [] }] }),
  ])('does not overwrite malformed or future draft storage: %s', (raw) => {
    localStorage.setItem(KEY, raw);
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect(saveSecondPassDraft(A, strokes('new'))).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('leaves malformed legacy bytes untouched when saving a new source', () => {
    const raw = '{potentially-recoverable-old-draft';
    localStorage.setItem(LEGACY_KEY, raw);
    expect(saveSecondPassDraft(B, strokes('b'))).toBe(true);
    expect(loadSecondPassDraft(B)).toEqual(strokes('b'));
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
  });

  it('preserves the legacy draft when its first migration fails', () => {
    const raw = JSON.stringify({
      ...A,
      fingerprint: JSON.stringify(A.fingerprint),
      strokes: strokes('old-a'),
    });
    localStorage.setItem(LEGACY_KEY, raw);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(saveSecondPassDraft(B, strokes('new-b'))).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
    expect(loadSecondPassDraft(A)).toEqual(strokes('old-a'));
  });

  it('does not silently replace invalid new selection values with JSON null', () => {
    saveSecondPassDraft(A, strokes('saved'));
    const previous = localStorage.getItem(KEY);
    expect(saveSecondPassDraft(A, [{ ...strokes('invalid')[0]!, radiusMm: Infinity }])).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(previous);
  });

  it('reports storage read failures without attempting a replacement write', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect(saveSecondPassDraft(A, strokes('new'))).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
