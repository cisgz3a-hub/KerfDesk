import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { applyTransformDrag } from '../workspace/apply-transform-drag';
import { DEFAULT_SNAP_SETTINGS, type SnapGuide } from '../workspace/snapping';
import { useUiStore } from './ui-store';

const horizontal: SnapGuide = { axis: 'x', positionMm: 20, fromMm: 0, toMm: 10 };
const vertical: SnapGuide = { axis: 'y', positionMm: 30, fromMm: 2, toMm: 15 };
let updates = 0;
let unsubscribe: () => void;

beforeEach(() => {
  useUiStore.setState({ snapGuides: [] });
  updates = 0;
  unsubscribe = useUiStore.subscribe((next, previous) => {
    if (next.snapGuides !== previous.snapGuides) updates += 1;
  });
});
afterEach(() => unsubscribe());

function hoverMoves(count: number): void {
  const project = createProject();
  for (let i = 0; i < count; i += 1) {
    applyTransformDrag({
      drag: null,
      point: { x: i, y: 10 },
      e: { shiftKey: false, ctrlKey: false, metaKey: false },
      project,
      selectionAnchor: 'c',
      snapSettings: DEFAULT_SNAP_SETTINGS,
      setObjectTransform: () => {
        throw new Error('Hover must not transform artwork');
      },
      setSnapGuides: useUiStore.getState().setSnapGuides,
    });
  }
}

describe('snap guide redraw notifications', () => {
  it('does not invalidate the canvas on plain pointer movement', () => {
    const before = useUiStore.getState().snapGuides;
    hoverMoves(60);
    expect(updates).toBe(0);
    expect(useUiStore.getState().snapGuides).toBe(before);
  });

  it('clears stale guides once when a drag ends', () => {
    useUiStore.getState().setSnapGuides([horizontal]);
    updates = 0;
    hoverMoves(60);
    expect(updates).toBe(1);
    expect(useUiStore.getState().snapGuides).toEqual([]);
  });

  it('retains an unchanged visible guide sequence despite fresh calculation objects', () => {
    useUiStore.getState().setSnapGuides([horizontal, vertical]);
    const before = useUiStore.getState().snapGuides;
    updates = 0;
    useUiStore.getState().setSnapGuides([{ ...horizontal }, { ...vertical }]);
    expect(updates).toBe(0);
    expect(useUiStore.getState().snapGuides).toBe(before);
  });

  it.each([
    [{ ...horizontal, axis: 'y' as const }, vertical],
    [{ ...horizontal, positionMm: horizontal.positionMm + 1e-10 }, vertical],
    [{ ...horizontal, fromMm: -1 }, vertical],
    [{ ...horizontal, toMm: 11 }, vertical],
    [vertical, horizontal],
    [horizontal],
    [],
  ])('publishes changed guide geometry, order or visibility: %j', (...next: SnapGuide[]) => {
    useUiStore.getState().setSnapGuides([horizontal, vertical]);
    updates = 0;
    useUiStore.getState().setSnapGuides(next);
    expect(updates).toBe(1);
    expect(useUiStore.getState().snapGuides).toBe(next);
  });
});
