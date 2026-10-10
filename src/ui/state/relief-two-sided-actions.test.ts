import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  type Project,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { TWO_SIDED_FRAME_MM } from '../../core/relief/relief-two-sided-split';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// ADR-580: splitting an STL relief for two-sided carving replaces it with a
// side A and a side B relief in one undo step and assigns them to the sides.

// An octahedron 20 mm across and 10 mm tall, in millimetres.
function octahedron(): number[] {
  const top = [10, 10, 10];
  const bottom = [10, 10, 0];
  const ring = [
    [0, 10, 5],
    [10, 0, 5],
    [20, 10, 5],
    [10, 20, 5],
  ];
  const p: number[] = [];
  for (let k = 0; k < 4; k += 1) {
    const a = ring[k] ?? [];
    const b = ring[(k + 1) % 4] ?? [];
    p.push(...top, ...a, ...b, ...bottom, ...b, ...a);
  }
  return p;
}

function relief(): MeshReliefObject {
  return {
    kind: 'relief',
    id: 'model',
    source: 'model.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: octahedron(), emptyCells: 'floor' },
    targetWidthMm: 20,
    reliefDepthMm: 10,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: {
      x: 40,
      y: 30,
      rotationDeg: 30,
      scaleX: 1,
      scaleY: 1,
      mirrorX: false,
      mirrorY: false,
    },
  };
}

function project(): Project {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 14 },
    },
    scene: {
      objects: [relief()],
      layers: [createLayer({ id: 'relief-op', color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
}

describe('splitReliefForTwoSides', () => {
  beforeEach(() => resetStore());

  it('replaces the relief with both sides, keeps the model in place and assigns the sides', () => {
    useStore.setState({ project: project(), undoStack: [], redoStack: [] });
    const before = useStore.getState().project;
    const result = useStore
      .getState()
      .splitReliefForTwoSides('model', { splitHeightMm: 5, webMm: 1, marginMm: 6 });
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result).toMatchObject({ fitsStock: true, stockThicknessMm: 14, setupEnabled: true });

    const state = useStore.getState();
    const objects = state.project.scene.objects;
    expect(objects.map((object) => object.id)).toEqual([result.sideAId, result.sideBId]);
    const inset = 6 + TWO_SIDED_FRAME_MM;
    const original = relief();
    for (const side of objects) {
      if (side.kind !== 'relief') throw new Error('expected a relief');
      // The model's corner, inset into each side's frame, lands where it stood.
      const corner = applyTransform({ x: inset, y: inset }, side.transform);
      const was = applyTransform({ x: 0, y: 0 }, original.transform);
      expect(corner.x).toBeCloseTo(was.x, 9);
      expect(corner.y).toBeCloseTo(was.y, 9);
      expect(side.color).toBe(original.color);
    }
    expect(state.project.cncSetup?.twoSided).toMatchObject({
      activeSide: 'A',
      sideAObjectIds: [result.sideAId],
      sideBObjectIds: [result.sideBId],
    });
    expect(state.selectedObjectId).toBe(result.sideAId);

    state.undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('adds the sides to an existing two-sided setup without changing its flip', () => {
    const base = project();
    useStore.setState({
      project: {
        ...base,
        cncSetup: {
          id: 'setup',
          name: 'Setup 1',
          notes: '',
          wcs: 'G54',
          zDatum: 'stock-top',
          fixtures: [],
          twoSided: {
            activeSide: 'B',
            flipAxis: 'x',
            sideBStockOriginMm: { x: 5, y: 5 },
            sideAObjectIds: ['model', 'other'],
            sideBObjectIds: ['back'],
            registration: [],
          },
        },
      },
    });
    const result = useStore
      .getState()
      .splitReliefForTwoSides('model', { splitHeightMm: 5, webMm: 0, marginMm: 6 });
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(useStore.getState().project.cncSetup?.twoSided).toMatchObject({
      activeSide: 'B',
      flipAxis: 'x',
      sideAObjectIds: ['other', result.sideAId],
      sideBObjectIds: ['back', result.sideBId],
    });
  });

  it('reports a split outside the model and changes nothing', () => {
    useStore.setState({ project: project() });
    const before = useStore.getState().project;
    const result = useStore
      .getState()
      .splitReliefForTwoSides('model', { splitHeightMm: 12, webMm: 1, marginMm: 6 });
    expect(result.kind).toBe('error');
    expect(useStore.getState().project).toBe(before);
  });
});
