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
  it('reopens A and B independently and only replaces the edited source', () => {
    expect(saveSecondPassDraft(A, strokes('a'))).toBe(true);
    expect(saveSecondPassDraft(B, strokes('b'))).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a'));
    expect(loadSecondPassDraft(B)).toEqual(strokes('b'));
    expect(saveSecondPassDraft(A, strokes('a-edited'))).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a-edited'));
    expect(loadSecondPassDraft(B)).toEqual(strokes('b'));
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
    expect(loadSecondPassDraft(A)).toEqual(strokes('a'));
    expect(loadSecondPassDraft(revised)).toEqual(strokes('revised-a'));
  });

  it('retains the 20 most recently saved sources, including an older source edited again', () => {
    const sources = Array.from({ length: 21 }, (_, index) => ({ ...A, runId: `job-${index}` }));
    for (const source of sources.slice(0, 20))
      expect(saveSecondPassDraft(source, strokes(source.runId))).toBe(true);
    expect(saveSecondPassDraft(sources[0]!, strokes('oldest-edited'))).toBe(true);
    expect(saveSecondPassDraft(sources[20]!, strokes('newest'))).toBe(true);
    expect(loadSecondPassDraft(sources[0]!)).toEqual(strokes('oldest-edited'));
    expect(loadSecondPassDraft(sources[1]!)).toEqual([]);
    for (const source of sources.slice(2, 20))
      expect(loadSecondPassDraft(source)).toEqual(strokes(source.runId));
    expect(loadSecondPassDraft(sources[20]!)).toEqual(strokes('newest'));
    expect((JSON.parse(localStorage.getItem(KEY)!) as { drafts: unknown[] }).drafts).toHaveLength(
      20,
    );
  });

  it('reads legacy data without writing, then migrates it with the next successful save', () => {
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
    expect(loadSecondPassDraft(A)).toEqual(strokes('legacy-a'));
    expect(loadSecondPassDraft(B)).toEqual(strokes('new-b'));
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy);
    expect(saveSecondPassDraft(A, [])).toBe(true);
    expect(loadSecondPassDraft(A)).toEqual([]);
  });

  it('does not resurrect an evicted legacy draft beyond the 20-source retention bound', () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        ...A,
        fingerprint: JSON.stringify(A.fingerprint),
        strokes: strokes('old-a'),
      }),
    );
    for (let index = 0; index < 20; index += 1) {
      expect(saveSecondPassDraft({ ...B, runId: `new-${index}` }, strokes(String(index)))).toBe(
        true,
      );
    }
    expect(loadSecondPassDraft(A)).toEqual([]);
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });
});

describe('painted draft write failure', () => {
  it('keeps both saved drafts and reports quota failure when an update cannot be committed', () => {
    saveSecondPassDraft(A, strokes('a'));
    saveSecondPassDraft(B, strokes('b'));
    const previous = localStorage.getItem(KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(saveSecondPassDraft(A, strokes('unsaved-a'))).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(previous);
    expect(loadSecondPassDraft(A)).toEqual(strokes('a'));
    expect(loadSecondPassDraft(B)).toEqual(strokes('b'));
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
