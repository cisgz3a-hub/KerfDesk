// The toast rules of ADR-708 (annoyance audit A5): lifetime by length, the
// paused countdown, one slot per key, and the session's notice history.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_HISTORY_LIMIT, useNoticeHistory } from './notice-history';
import { toastLifetimeMs, useToastStore, VISIBLE_TOASTS } from './toast-store';

const push = useToastStore.getState().pushToast;
const messages = (): ReadonlyArray<string> => useToastStore.getState().toasts.map((t) => t.message);
const onlyToast = (): { readonly id: string } => {
  const [toast] = useToastStore.getState().toasts;
  if (toast === undefined) throw new Error('expected a toast');
  return toast;
};

beforeEach(() => {
  vi.useFakeTimers();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  useNoticeHistory.getState().clearNotices();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('toast lifetime', () => {
  it('keeps the variant minimum for a short text', () => {
    expect(toastLifetimeMs('success', 'Saved')).toBe(4000);
    expect(toastLifetimeMs('info', 'Importing logo.svg')).toBe(8000);
    expect(toastLifetimeMs('warning', 'Check the fixture')).toBe(8000);
    expect(toastLifetimeMs('error', 'Could not save')).toBe(8000);
  });

  it('adds reading time for a long text: 2 s plus 60 ms a character', () => {
    expect(toastLifetimeMs('success', 'x'.repeat(231))).toBe(2000 + 60 * 231);
    expect(toastLifetimeMs('warning', 'x'.repeat(249))).toBe(2000 + 60 * 249);
    // The minimum still wins just above it: 100 characters read in 8 s.
    expect(toastLifetimeMs('warning', 'x'.repeat(100))).toBe(8000);
    expect(toastLifetimeMs('warning', 'x'.repeat(101))).toBe(8060);
  });

  it('never keeps a toast longer than 30 s', () => {
    expect(toastLifetimeMs('success', 'x'.repeat(467))).toBe(30_000);
    expect(toastLifetimeMs('error', 'x'.repeat(5000))).toBe(30_000);
  });

  it('holds a long success on screen past the four seconds a short one gets', () => {
    push('x'.repeat(390), 'success');
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2000 + 60 * 390 - 4000 - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('pausing a toast', () => {
  it('stops the countdown and resumes with the time that was left', () => {
    push('Check the fixture', 'warning');
    const { id } = onlyToast();
    vi.advanceTimersByTime(3000);
    useToastStore.getState().pauseToast(id);
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().resumeToast(id);
    vi.advanceTimersByTime(4999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('gives a toast paused in its last moment two more seconds', () => {
    push('Saved', 'success');
    const { id } = onlyToast();
    vi.advanceTimersByTime(3900);
    useToastStore.getState().pauseToast(id);
    useToastStore.getState().resumeToast(id);
    vi.advanceTimersByTime(1999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('leaves no timer behind when a paused toast is dismissed', () => {
    push('Check the fixture', 'warning');
    const { id } = onlyToast();
    useToastStore.getState().pauseToast(id);
    expect(vi.getTimerCount()).toBe(0);
    useToastStore.getState().dismissToast(id);
    useToastStore.getState().resumeToast(id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart a toast the operator opened to read', () => {
    push('Technical notes (2)', 'info', { details: ['a', 'b'] });
    const { id } = onlyToast();
    useToastStore.getState().pauseToast(id);
    useToastStore.getState().holdToast(id);
    useToastStore.getState().resumeToast(id);
    vi.advanceTimersByTime(120_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('keeps a slot rewritten under the pointer paused, with a fresh lifetime', () => {
    push('Jog target is outside', 'warning', { key: 'jog' });
    const { id } = onlyToast();
    vi.advanceTimersByTime(7000);
    useToastStore.getState().pauseToast(id);
    push('Jog target is outside', 'warning', { key: 'jog' });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().resumeToast(id);
    vi.advanceTimersByTime(7999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('a keyed toast', () => {
  it('is one slot: the same key rewrites it and restarts its time', () => {
    push('Step 1', 'warning', { key: 'slot' });
    const { id } = onlyToast();
    vi.advanceTimersByTime(7000);
    push('Step 2', 'error', { key: 'slot', details: ['why'] });
    expect(useToastStore.getState().toasts).toEqual([
      { id, key: 'slot', message: 'Step 2', variant: 'error', details: ['why'] },
    ]);
    vi.advanceTimersByTime(7999);
    expect(messages()).toEqual(['Step 2']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('drops the notes of the text it replaces', () => {
    push('Notes', 'info', { key: 'slot', details: ['a'] });
    push('Plain', 'info', { key: 'slot' });
    expect(onlyToast()).not.toHaveProperty('details');
  });

  it('keeps its place while it is on screen', () => {
    push('slot', 'info', { key: 'slot' });
    push('b');
    push('c');
    push('slot again', 'info', { key: 'slot' });
    expect(messages()).toEqual(['slot again', 'b', 'c']);
  });

  it('comes back as the newest once newer toasts pushed it out of view', () => {
    push('slot', 'info', { key: 'slot' });
    for (let index = 0; index < VISIBLE_TOASTS; index += 1) push(`later ${index}`);
    push('slot again', 'info', { key: 'slot' });
    expect(messages().at(-1)).toBe('slot again');
    expect(messages()).toHaveLength(VISIBLE_TOASTS + 1);
  });
});

describe('notice history', () => {
  const history = (): ReadonlyArray<string> =>
    useNoticeHistory.getState().notices.map((notice) => notice.message);

  it('keeps warnings and errors, newest first, and leaves out the rest', () => {
    push('Saved', 'success');
    push('Importing', 'info');
    push('Check the fixture', 'warning');
    push('Could not save', 'error');
    expect(history()).toEqual(['Could not save', 'Check the fixture']);
    expect(useNoticeHistory.getState().unseen).toBe(2);
  });

  it('outlives the toast, with its folded notes', () => {
    push('Opened old.lf2. 2 warnings below.', 'warning', { details: ['one', 'two'] });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(useNoticeHistory.getState().notices[0]).toMatchObject({
      message: 'Opened old.lf2. 2 warnings below.',
      variant: 'warning',
      details: ['one', 'two'],
      count: 1,
    });
  });

  it('counts a repeated notice on one row and moves it to the top', () => {
    push('Jog target is outside', 'warning', { key: 'jog' });
    push('Disk is full', 'error');
    for (let click = 0; click < 9; click += 1) {
      push('Jog target is outside', 'warning', { key: 'jog' });
    }
    expect(history()).toEqual(['Jog target is outside', 'Disk is full']);
    expect(useNoticeHistory.getState().notices[0]?.count).toBe(10);
    expect(useNoticeHistory.getState().unseen).toBe(2);
  });

  it('keeps a slot rewritten with new text as a row of its own', () => {
    push('Cannot start job: no connection', 'error', { key: 'start-refused' });
    push('Cannot start job: alarm', 'error', { key: 'start-refused' });
    expect(history()).toEqual(['Cannot start job: alarm', 'Cannot start job: no connection']);
  });

  it('is bounded: the oldest rows drop off', () => {
    for (let index = 0; index < NOTICE_HISTORY_LIMIT + 5; index += 1) {
      push(`warning ${index}`, 'warning');
    }
    expect(history()).toHaveLength(NOTICE_HISTORY_LIMIT);
    expect(history()[0]).toBe(`warning ${NOTICE_HISTORY_LIMIT + 4}`);
    expect(history().at(-1)).toBe('warning 5');
  });

  it('marks the list read, and a repeat of a read row is not news', () => {
    push('Check the fixture', 'warning');
    useNoticeHistory.getState().markNoticesSeen();
    expect(useNoticeHistory.getState().unseen).toBe(0);
    push('Check the fixture', 'warning');
    expect(useNoticeHistory.getState().unseen).toBe(0);
    push('Something new', 'warning');
    expect(useNoticeHistory.getState().unseen).toBe(1);
  });

  it('is emptied by Clear', () => {
    push('Check the fixture', 'warning');
    useNoticeHistory.getState().clearNotices();
    expect(useNoticeHistory.getState()).toMatchObject({ notices: [], unseen: 0 });
  });
});
