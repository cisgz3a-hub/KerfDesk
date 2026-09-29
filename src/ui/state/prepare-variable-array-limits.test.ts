// Variable copies and the project's object limit (ADR-307 amendment 1). Every
// copy of a variable array is rendered in turn, so a request the project has no
// room for is refused before the first render, not after one for each copy.

import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type GridArraySpec, type SceneObject } from '../../core/scene';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import type { AppState } from './store';
import { fixtureState, NOW, renderFixture } from './variable-array-test-fixture';

const LIMIT = PROJECT_SCENE_LIMITS.objects;

function filler(count: number): ReadonlyArray<SceneObject> {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'shape' as const,
    id: `filler-${index}`,
    spec: { kind: 'rect' as const, widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: { ...IDENTITY_TRANSFORM, x: 500 },
    color: '#000000',
    paths: [],
  }));
}

// The badge is three objects; `free` more fit in the project.
function stateWithRoomFor(free: number): AppState {
  const before = fixtureState();
  const objects = [...before.project.scene.objects, ...filler(LIMIT - 3 - free)];
  return {
    ...before,
    project: { ...before.project, scene: { ...before.project.scene, objects } },
  };
}

function row(instances: number): GridArraySpec {
  return { kind: 'grid', rows: 1, columns: instances, spacingX: 5, spacingY: 3 };
}

describe('variable copies and the project limit', () => {
  it('refuses a request the project has no room for before rendering any copy', async () => {
    const render = vi.fn(renderFixture);
    // Room for 4 more badges, so 5 instances; a row of 6 is one too many.
    const state = stateWithRoomFor(12);

    const result = await prepareVariableArray(state, row(6), { render, clock: () => NOW });

    expect(result).toEqual({
      ok: false,
      message:
        'This project has room for at most 4 more copies of this selection (project limit 10000 objects). Use fewer rows or columns.',
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('prepares, and applies, exactly as many copies as fit', async () => {
    const render = vi.fn(renderFixture);
    const state = stateWithRoomFor(12);

    const result = await prepareVariableArray(state, row(5), { render, clock: () => NOW });

    if (!result.ok) throw new Error(result.message);
    // Two variable fields on each of the five badges.
    expect(render).toHaveBeenCalledTimes(10);
    const applied = applyArraySelection(state, row(5), undefined, result.materialized) as AppState;
    expect(applied.project.scene.objects).toHaveLength(LIMIT);
  });

  it.each([
    ['a grid of a million by a million', { ...row(1), rows: 1e6, columns: 1e6 }],
    ['a circle of a trillion', circle(1e12)],
    [
      'a point rotation of 1e300',
      { kind: 'point-rotation' as const, count: 1e300, totalAngleDeg: 90 },
    ],
  ])('refuses %s without rendering or throwing', async (_name, spec) => {
    const render = vi.fn(renderFixture);

    const result = await prepareVariableArray(fixtureState(), spec, { render, clock: () => NOW });

    expect(result).toMatchObject({ ok: false });
    expect(render).not.toHaveBeenCalled();
  });
});

function circle(count: number) {
  return {
    kind: 'circular' as const,
    count,
    centerX: 50,
    centerY: 50,
    radius: 30,
    startAngleDeg: 0,
    rotateCopies: false,
  };
}
