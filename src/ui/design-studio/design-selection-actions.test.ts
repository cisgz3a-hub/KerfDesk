import { beforeEach, expect, it, vi } from 'vitest';
import { createDesignSession } from './design-session';
import { useDesignStudioStore as studio } from './design-studio-store';
import { handleDesignStudioKey } from './design-shortcuts';

const state = () => studio.getState();
beforeEach(() => {
  studio.setState({ session: createDesignSession(), stash: null });
  state().setSketch({
    entities: [
      {
        id: 'a',
        kind: 'circle',
        center: { x: 10, y: 10 },
        radiusMm: 5,
        layerId: 'cut',
        construction: true,
      },
      { id: 'b', kind: 'line', start: { x: 40, y: 20 }, end: { x: 50, y: 25 } },
      { id: 'c', kind: 'circle', center: { x: 80, y: 80 }, radiusMm: 10 },
    ],
  });
});

function chord(
  key: string,
  target: EventTarget = document.createElement('div'),
): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn();
  handleDesignStudioKey(
    {
      key,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target,
      preventDefault,
    } as unknown as React.KeyboardEvent<HTMLDivElement>,
    () => undefined,
  );
  return preventDefault;
}

it('Ctrl+A selects all without a history entry and Ctrl+D copies the set in one undo step', () => {
  state().setTool('rect');
  const before = state().session!;
  expect(chord('a')).toHaveBeenCalled();
  expect([...state().session!.selectedIds]).toEqual(['a', 'b', 'c']);
  expect(state().session!.tool).toBe('select');
  expect(state().session!.history).toBe(before.history);
  expect(chord('d')).toHaveBeenCalled();
  const copied = state().session!;
  expect(copied.history.past.length).toBe(before.history.past.length + 1);
  expect(copied.history.present.entities).toHaveLength(6);
  const copies = copied.history.present.entities.slice(3);
  expect(copies[0]).toMatchObject({
    center: { x: 15, y: 15 },
    radiusMm: 5,
    construction: true,
    layerId: 'cut',
  });
  expect(copies[1]).toMatchObject({ start: { x: 45, y: 25 }, end: { x: 55, y: 30 } });
  expect([...copied.selectedIds]).toEqual(copies.map((entity) => entity.id));
  expect(new Set(copied.history.present.entities.map((entity) => entity.id)).size).toBe(6);
  state().undo();
  expect(state().session!.history.present).toBe(before.history.present);
  state().redo();
  expect(state().session!.history.present).toBe(copied.history.present);
});

it('alignment and distribution each commit once; repeating a no-op preserves history', () => {
  state().selectAll();
  const before = state().session!;
  state().alignSelection('top');
  const aligned = state().session!;
  expect(aligned.history.past.length).toBe(before.history.past.length + 1);
  state().alignSelection('top');
  expect(state().session).toBe(aligned);
  state().distributeSelection('horizontal-spacing');
  const distributed = state().session!;
  expect(distributed.history.past.length).toBe(aligned.history.past.length + 1);
  state().undo();
  expect(state().session!.history.present).toBe(aligned.history.present);
});

it('empty and stale duplicate selections neither change geometry nor record history', () => {
  state().setSelection(['missing']);
  const before = state().session;
  state().duplicateSelection();
  expect(state().session).toBe(before);
});

it('native text inputs keep Ctrl+A and Ctrl+D', () => {
  const before = state().session;
  const input = document.createElement('input');
  expect(chord('a', input)).not.toHaveBeenCalled();
  expect(chord('d', input)).not.toHaveBeenCalled();
  expect(state().session).toBe(before);
});

it('selection actions ignore a closed studio', () => {
  state().closeStudio();
  state().selectAll();
  state().duplicateSelection();
  state().alignSelection('left');
  state().distributeSelection('horizontal-centers');
  expect(state().session).toBeNull();
});
