// S9-P3-3: the Fill-pool planner kept each pool key's last overlap groups,
// with the pool's scene objects, for the rest of the session. A trace that was
// undone, or a project closed, left its geometry behind. The groups are now
// kept for the keys of the last two plans only. Counted, not timed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createDisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { resetFillPoolPlansForTests } from './fill-pool-plan-cache';
import { RecentPlanValues } from './fill-pool-recent-keys';
import { keptFillPoolGroupCount } from './fill-pools';

beforeEach(() => {
  vi.stubGlobal('Path2D', undefined);
  resetFillPoolPlansForTests();
});
afterEach(() => vi.unstubAllGlobals());

function rect(id: string, color: string, x: number): SceneObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  });
}

// One Fill operation with two overlapping squares: one pool, one key, as a
// traced image gets its own Fill operation.
function fillProject(n: number): Project {
  const color = `#0000${n.toString(16).padStart(2, '0')}`;
  const layer = { ...createLayer({ id: `op-${n}`, color, mode: 'fill' }), hatchSpacingMm: 0.5 };
  return {
    ...createProject(),
    scene: { layers: [layer], objects: [rect(`a-${n}`, color, 10), rect(`b-${n}`, color, 15)] },
  };
}

function draw(project: Project): void {
  const canvas = { width: 400, height: 300 };
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'canvas'
          ? canvas
          : prop === 'measureText'
            ? () => ({ width: 0 })
            : () => undefined,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  drawScene(ctx, 400, 300, project, {
    selectedId: null,
    preview: false,
    view: { zoomFactor: 1, panX: 0, panY: 0 },
    displayPolylineCache: createDisplayPolylineCache(),
  });
}

describe('Fill-pool groups are kept for the last two plans (S9-P3-3)', () => {
  it('stays bounded over a session of operations that come and go', () => {
    for (let n = 0; n < 30; n += 1) draw(fillProject(n));
    // Main kept all 30 pools' objects for the rest of the session.
    expect(keptFillPoolGroupCount()).toBeLessThanOrEqual(2);
  });

  it('keeps both of two canvases that plan in turn', () => {
    const first = fillProject(40);
    const second = fillProject(41);
    for (let round = 0; round < 3; round += 1) {
      draw(first);
      draw(second);
    }
    expect(keptFillPoolGroupCount()).toBe(2);
  });
});

describe('RecentPlanValues', () => {
  it('drops a key once neither of the last two plans used it', () => {
    const values = new RecentPlanValues<number>();
    values.set('a', 1);
    values.endPlan();
    values.set('b', 2);
    values.endPlan();
    expect(values.get('a')).toBe(1);
    values.set('b', 3);
    values.endPlan();
    expect(values.get('a')).toBeUndefined();
    expect(values.get('b')).toBe(3);
    expect(values.size).toBe(1);
  });
});
