import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { detectCncTwoSidedStockWarnings } from './cnc-two-sided-stock-warnings';

// ADR-580 Amendment 1: Job Review says where a split side's program is not the
// model — stock thinner than the model, a side with no stock left — and when a
// side split by an earlier version cannot follow the stock.

// A closed 20 × 20 × 10 mm block.
function block(): number[] {
  const p: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10]);
  quad([0, 0, 0], [0, 20, 0], [20, 20, 0], [20, 0, 0]);
  return p;
}

function relief(): MeshReliefObject {
  return {
    kind: 'relief',
    id: 'model',
    source: 'model.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: block(), emptyCells: 'floor' },
    targetWidthMm: 20,
    reliefDepthMm: 10,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 30 },
  };
}

function withStock(project: Project, thicknessMm: number): Project {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return { ...project, machine: { ...machine, stock: { ...machine.stock, thicknessMm } } };
}

function split(splitHeightMm = 5): Project {
  useStore.setState({
    project: withStock(
      {
        ...createProject(),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: {
          objects: [relief()],
          layers: [createLayer({ id: 'relief-op', color: DEFAULT_RELIEF_LAYER_COLOR })],
        },
      },
      14,
    ),
  });
  const result = useStore
    .getState()
    .splitReliefForTwoSides('model', { splitHeightMm, webMm: 1, marginMm: 4 });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return useStore.getState().project;
}

describe('detectCncTwoSidedStockWarnings', () => {
  afterEach(() => resetStore());

  it('says nothing while the stock is at least as thick as the model', () => {
    const project = split();
    expect(detectCncTwoSidedStockWarnings(project)).toEqual([]);
    expect(detectCncTwoSidedStockWarnings(withStock(project, 18))).toEqual([]);
    expect(detectCncTwoSidedStockWarnings(withStock(project, 10))).toEqual([]);
  });

  it('says the stock faces cut a model thicker than the stock down', () => {
    const [warning, ...rest] = detectCncTwoSidedStockWarnings(withStock(split(), 8));
    expect(rest).toEqual([]);
    expect(warning).toContain('The 10 mm model of "model.stl (side A, top)"');
    expect(warning).toContain('the part comes out 8 mm thick');
  });

  it('says when a side has no stock left to carve', () => {
    // A 9 mm split: 6 mm stock centred on the 10 mm model lies wholly under it.
    const [warning] = detectCncTwoSidedStockWarnings(withStock(split(9), 6));
    expect(warning).toContain('has no stock to carve');
  });

  it('asks for a re-split of a side split before the stock was recorded', () => {
    const project = split();
    const legacy: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) => {
          if (object.kind !== 'relief') return object;
          const { twoSidedSplit: _record, ...side } = object as MeshReliefObject;
          return side;
        }),
      },
    };
    const [warning] = detectCncTwoSidedStockWarnings(legacy);
    expect(warning).toContain('"model.stl (side A, top)" was split by an earlier version');
    expect(warning).toContain('re-split the model for the new stock');
  });
});
