import { beforeEach, expect, it } from 'vitest';
import { resetStore } from '../state/test-helpers';
import { clearPersistedSession } from './design-session-storage';
import { useDesignStudioStore as studio } from './design-studio-store';

const state = () => studio.getState();
beforeEach(() => {
  resetStore();
  clearPersistedSession();
  studio.setState({ session: null, stash: null, documentEpoch: -1 });
  void state().openStudio();
  state().setSketch({
    entities: [
      {
        id: 'a',
        kind: 'rect',
        origin: { x: 0, y: 0 },
        widthMm: 20,
        heightMm: 10,
        cornerRadiusMm: 2,
      },
      { id: 'b', kind: 'line', start: { x: 30, y: 20 }, end: { x: 40, y: 40 } },
    ],
  });
});

it.each(['rotate-left', 'rotate-right', 'flip-horizontal', 'flip-vertical'] as const)(
  '%s commits the entire selection as one undo step and restores it on redo',
  (kind) => {
    state().selectAll();
    const before = state().session!;
    state().transformSelection(kind);
    const after = state().session!;
    expect(after.history.past.length).toBe(before.history.past.length + 1);
    expect(after.history.present).not.toEqual(before.history.present);
    expect([...after.selectedIds]).toEqual(['a', 'b']);
    state().undo();
    expect(state().session!.history.present).toBe(before.history.present);
    state().redo();
    expect(state().session!.history.present).toBe(after.history.present);
  },
);

it('does not record invisible symmetric flips or stale selections', () => {
  state().setSelection(['a']);
  const before = state().session;
  state().transformSelection('flip-horizontal');
  expect(state().session).toBe(before);
  state().setSelection(['missing']);
  const stale = state().session;
  state().transformSelection('rotate-right');
  expect(state().session).toBe(stale);
});

it('retains transformed geometry across close and reopen; ignores actions while closed', () => {
  state().selectAll();
  state().transformSelection('rotate-right');
  const after = state().session;
  state().closeStudio();
  state().transformSelection('flip-horizontal');
  expect(state().session).toBeNull();
  void state().openStudio();
  expect(state().session).toBe(after);
});
