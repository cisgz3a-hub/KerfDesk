// One toast for one action (annoyance audit A5-P2-6, ADR-708).
import { describe, expect, it } from 'vitest';
import { foldNotices, pushFoldedNotice, pushNoticeGroup, type Notice } from './folded-notice';
import type { ToastOptions, ToastVariant } from './toast-store';

type Pushed = readonly [string, ToastVariant | undefined, ToastOptions | undefined];

function collector(): {
  readonly pushed: Pushed[];
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
} {
  const pushed: Pushed[] = [];
  return {
    pushed,
    pushToast: (message, variant, options) => void pushed.push([message, variant, options]),
  };
}

const RESULT: Notice = { message: 'Imported logo.svg — 3 objects, 2 colors', variant: 'success' };
const info = (message: string): Notice => ({ message, variant: 'info' });
const warning = (message: string): Notice => ({ message, variant: 'warning' });
const lines = (...text: ReadonlyArray<string>): string => text.join('\n');

describe('foldNotices', () => {
  it('is the result alone when there are no notes', () => {
    expect(foldNotices(RESULT, [])).toEqual(RESULT);
  });

  it('says up to three notes in the open, one a line, in the order given', () => {
    expect(
      foldNotices(RESULT, [
        info('logo.svg: 2 text elements ignored'),
        warning('logo.svg was scaled to 50% to fit.'),
        warning('logo.svg: 1 solid white shape will not burn.'),
      ]),
    ).toEqual({
      message: lines(
        RESULT.message,
        'logo.svg: 2 text elements ignored',
        'logo.svg was scaled to 50% to fit.',
        'logo.svg: 1 solid white shape will not burn.',
      ),
      variant: 'warning',
    });
  });

  it('folds what does not fit: plain notes before warnings, earlier before later', () => {
    // The seven an SVG import can describe: its result and six notes.
    const folded = foldNotices(RESULT, [
      info('logo.svg: sanitized 1 script tag'),
      info('logo.svg: 2 text elements ignored'),
      warning('logo.svg: SVG presentation: a filter was ignored.'),
      warning('logo.svg: SVG size: no units.'),
      warning('logo.svg was scaled to 50% to fit.'),
      warning('logo.svg: 1 solid white shape will not burn.'),
    ]);
    expect(folded).toEqual({
      message: lines(
        RESULT.message,
        'logo.svg: SVG size: no units.',
        'logo.svg was scaled to 50% to fit.',
        'logo.svg: 1 solid white shape will not burn.',
        '1 more warning and 2 more notes below.',
      ),
      variant: 'warning',
      details: [
        'logo.svg: SVG presentation: a filter was ignored.',
        'logo.svg: sanitized 1 script tag',
        'logo.svg: 2 text elements ignored',
      ],
    });
  });

  it('keeps a warning in the open ahead of a later plain note', () => {
    const folded = foldNotices(RESULT, [warning('w1'), info('i1'), info('i2'), info('i3')]);
    expect(folded.message).toBe(lines(RESULT.message, 'w1', 'i2', 'i3', '1 more note below.'));
    expect(folded.details).toEqual(['i1']);
  });

  it('takes the most serious variant among its parts', () => {
    expect(foldNotices(RESULT, [info('a'), info('b')]).variant).toBe('info');
    expect(foldNotices(RESULT, [info('a'), { message: 'b', variant: 'error' }]).variant).toBe(
      'error',
    );
    expect(foldNotices({ ...RESULT, variant: 'warning' }, [info('a')]).variant).toBe('warning');
    // A folded warning still colours the toast.
    expect(foldNotices(RESULT, [warning('w'), info('a'), info('b'), info('c')]).variant).toBe(
      'warning',
    );
  });

  it("keeps a note's own details and never lists a line twice", () => {
    const folded = foldNotices(RESULT, [
      { message: 'a', variant: 'warning', details: ['why a'] },
      warning('b'),
      warning('c'),
      warning('d'),
      { message: 'e', variant: 'info', details: ['why a', 'why e'] },
    ]);
    expect(folded.message).toBe(
      lines(RESULT.message, 'b', 'c', 'd', '1 more warning and 1 more note below.'),
    );
    expect(folded.details).toEqual(['a', 'why a', 'e', 'why e']);
  });
});

describe('pushFoldedNotice', () => {
  it('pushes one keyed toast for the whole action', () => {
    const { pushed, pushToast } = collector();
    pushFoldedNotice(pushToast, 'svg-import:logo.svg', RESULT, [
      warning('a'),
      warning('b'),
      warning('c'),
      warning('d'),
    ]);
    expect(pushed).toEqual([
      [
        lines(RESULT.message, 'b', 'c', 'd', '1 more warning below.'),
        'warning',
        { key: 'svg-import:logo.svg', details: ['a'] },
      ],
    ]);
  });

  it('pushes a result without notes as itself, in the same slot', () => {
    const { pushed, pushToast } = collector();
    pushFoldedNotice(pushToast, 'project-notices', RESULT, []);
    expect(pushed).toEqual([[RESULT.message, 'success', { key: 'project-notices' }]]);
  });
});

describe('pushNoticeGroup', () => {
  it('pushes nothing for no notes and the note itself for one', () => {
    const { pushed, pushToast } = collector();
    pushNoticeGroup(pushToast, 'project-notices', 'About this project:', []);
    expect(pushed).toEqual([]);
    pushNoticeGroup(pushToast, 'project-notices', 'About this project:', [warning('a')]);
    expect(pushed).toEqual([['a', 'warning', { key: 'project-notices' }]]);
  });

  it('puts several notes under the subject in one toast', () => {
    const { pushed, pushToast } = collector();
    pushNoticeGroup(pushToast, 'project-notices', 'About this project:', [
      info('migrated'),
      warning('a'),
    ]);
    expect(pushed).toEqual([
      [lines('About this project:', 'migrated', 'a'), 'warning', { key: 'project-notices' }],
    ]);
  });
});
