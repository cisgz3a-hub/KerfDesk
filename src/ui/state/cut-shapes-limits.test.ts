// Cut Shapes and the project's limits (ADR-307 amendment 1). Each shape the
// cutter crosses becomes two pieces, so a cut adds objects. A project past
// PROJECT_SCENE_LIMITS saves but cannot be opened again, so a cut that would
// take it past one is refused with a notice and changes nothing, and a cut
// that fits is made exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  BLACK,
  currentProject,
  expectUnchanged,
  lastToast,
  loadScene,
  OBJECT_LIMIT,
  pastTheLimit,
  rects,
} from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

const ASK = 'Cut fewer shapes, or delete some objects first.';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function art(id: string, polyline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: BLACK, polylines: [polyline] }],
  };
}

// Three shapes and, on top, a cutter across the middle of each: the cut
// takes the cutter and the three shapes out and puts six pieces in, two
// objects more than before.
const SHAPES = [0, 1, 2].map((index) => art(`shape-${index}`, square(index * 20, 0, 10)));
const CUTTER = art('cutter', square(-5, 5, 100));
const SELECTED = [...SHAPES, CUTTER].map((object) => object.id);

function loadWithOthers(others: number) {
  return loadScene([...rects(others), ...SHAPES, CUTTER], SELECTED);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Cut Shapes and the project limits', () => {
  it('refuses a cut that would take the project one object past its limit', () => {
    // 9,995 other objects: 9,999 before the cut, 10,001 after it.
    const before = loadWithOthers(OBJECT_LIMIT - 5);

    expect(useStore.getState().cutSelectedShapes()).toBe(false);

    expectUnchanged(before);
    expect(useStore.getState().selectedObjectId).toBe('shape-0');
    // Only the refusal: no "Cut 3 shapes into 6 pieces." for a cut not made.
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      pastTheLimit('objects', OBJECT_LIMIT, ASK),
    ]);
    expect(lastToast()?.variant).toBe('warning');
  });

  it('cuts to exactly the limit, as before, in one undo step', () => {
    const before = loadWithOthers(OBJECT_LIMIT - 6);

    expect(useStore.getState().cutSelectedShapes()).toBe(true);

    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().additionalSelectedIds.size).toBe(5);
    expect(lastToast()).toEqual({ message: 'Cut 3 shapes into 6 pieces.', variant: 'success' });
    expect(deserializeProject(serializeProject(currentProject())).kind).toBe('ok');
  });
});
