import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../../ui/state';
import { resetStore } from '../../ui/state/test-helpers';
import { deserializeProject, serializeProject } from '../project';
import { emitGcode } from './index';

// Audit F6-P1-1, ADR-580 Amendment 1: a two-sided split must follow a stock
// edit made after it. Through the real split action, Machine Setup's stock
// edit and the emitter, both side programs after the edit must be the programs
// a split on the new stock gives, and their floors must stay the web apart.

const COLOR = '#a0522d';
const MODEL_MM = 10;
// Not a binary fraction, so save and reload must keep the split levels exactly.
const SPLIT_MM = 5.3;
const WEB_MM = 1;

// A closed 20 × 12 × 10 mm block, in millimetres.
function block(): number[] {
  const p: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
  const [x, y, z] = [20, 12, MODEL_MM];
  quad([0, 0, z], [x, 0, z], [x, y, z], [0, y, z]);
  quad([0, 0, 0], [0, y, 0], [x, y, 0], [x, 0, 0]);
  quad([0, 0, 0], [x, 0, 0], [x, 0, z], [0, 0, z]);
  quad([0, y, 0], [0, y, z], [x, y, z], [x, y, 0]);
  quad([0, 0, 0], [0, 0, z], [0, y, z], [0, y, 0]);
  quad([x, 0, 0], [x, y, 0], [x, y, z], [x, 0, z]);
  return p;
}

function project(stockThicknessMm: number): Project {
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'block',
    source: 'block.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: block(), emptyCells: 'floor' },
    targetWidthMm: 20,
    reliefDepthMm: MODEL_MM,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 12 },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 300 },
  };
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'em-3175',
      stock: {
        ...DEFAULT_CNC_MACHINE_CONFIG.stock,
        thicknessMm: stockThicknessMm,
        widthMm: 100,
        heightMm: 80,
        originOffset: { x: 30, y: 40 },
      },
    },
    scene: {
      ...base.scene,
      objects: [relief],
      layers: [
        {
          ...createLayer({ id: 'relief', color: COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'engrave',
            toolId: 'em-3175',
            depthPerPassMm: 3,
            reliefFinishToolId: 'em-3175',
            reliefFinishStrategy: 'raster',
          },
        },
      ],
    },
  };
}

// Split on `splitStock`, then enter `stock` in Machine Setup › Stock.
function splitThenStock(splitStock: number, stock: number): Project {
  useStore.setState({ project: project(splitStock), undoStack: [], redoStack: [] });
  const result = useStore
    .getState()
    .splitReliefForTwoSides('block', { splitHeightMm: SPLIT_MM, webMm: WEB_MM, marginMm: 4 });
  if (result.kind !== 'ok') throw new Error(result.reason);
  useStore.getState().updateCncMachine({ stock: { thicknessMm: stock } });
  return useStore.getState().project;
}

// Each side's motion, without comments or the header.
function programs(p: Project): { readonly A: string[]; readonly B: string[] } {
  const side = (activeSide: 'A' | 'B'): string[] => {
    const twoSided = p.cncSetup?.twoSided;
    if (twoSided === undefined || p.cncSetup === undefined) throw new Error('not two-sided');
    const result = emitGcode({
      ...p,
      cncSetup: { ...p.cncSetup, twoSided: { ...twoSided, activeSide } },
    });
    expect(result.gcode).not.toBe('');
    // Motion is modal, so most moves are bare coordinate words.
    return result.gcode.split('\n').filter((line) => /^[^;(]*[XYZ]-?[\d.]/.test(line));
  };
  return { A: side('A'), B: side('B') };
}

function deepestZ(motion: ReadonlyArray<string>): number {
  let deepest = 0;
  for (const line of motion) {
    const z = /Z(-?[\d.]+)/.exec(line);
    if (z?.[1] !== undefined) deepest = Math.min(deepest, Number(z[1]));
  }
  return -deepest;
}

describe('two-sided relief sides follow the stock', () => {
  afterEach(() => resetStore());

  it('cuts the planned depths when the stock is unchanged', () => {
    const { A, B } = programs(splitThenStock(14, 14));
    // The model sits 2 mm under each face of 14 mm stock.
    expect(deepestZ(A)).toBeCloseTo(MODEL_MM + 2 - SPLIT_MM, 3);
    expect(deepestZ(B)).toBeCloseTo(2 + SPLIT_MM - WEB_MM, 3);
  }, 120_000);

  it.each([
    [14, 18],
    [14, 12.5],
    // The stock is thinner than the model at the split, then the real board.
    [6.35, 14],
  ])(
    'split on %s mm, then %s mm stock: the programs a split on that stock gives',
    (from, to) => {
      const edited = programs(splitThenStock(from, to));
      const fresh = programs(splitThenStock(to, to));
      expect(edited.A).toEqual(fresh.A);
      expect(edited.B).toEqual(fresh.B);
      expect(deepestZ(edited.A)).toBeCloseTo((to + MODEL_MM) / 2 - SPLIT_MM, 3);
      expect(deepestZ(edited.B)).toBeCloseTo((to - MODEL_MM) / 2 + SPLIT_MM - WEB_MM, 3);
      expect(to - deepestZ(edited.A) - deepestZ(edited.B)).toBeCloseTo(WEB_MM, 3);
    },
    240_000,
  );

  it('keeps the web on stock thinner than the model', () => {
    const { A, B } = programs(splitThenStock(14, 8));
    expect(deepestZ(A)).toBeCloseTo((8 + MODEL_MM) / 2 - SPLIT_MM, 3);
    expect(deepestZ(B)).toBeCloseTo((8 - MODEL_MM) / 2 + SPLIT_MM - WEB_MM, 3);
    expect(8 - deepestZ(A) - deepestZ(B)).toBeCloseTo(WEB_MM, 3);
  }, 120_000);

  it('carries the split stock through save and reload', () => {
    const edited = splitThenStock(14, 12.5);
    const loaded = deserializeProject(serializeProject(edited));
    if (loaded.kind !== 'ok') throw new Error(loaded.kind);
    const records = loaded.project.scene.objects.map((object) =>
      object.kind === 'relief' && object.reliefSource.kind === 'legacy-mesh'
        ? (object as { twoSidedSplit?: unknown }).twoSidedSplit
        : undefined,
    );
    expect(records).toEqual([
      {
        side: 'A',
        stockThicknessMm: 14,
        modelDepthMm: MODEL_MM,
        splitHeightMm: SPLIT_MM,
        webMm: WEB_MM,
      },
      {
        side: 'B',
        stockThicknessMm: 14,
        modelDepthMm: MODEL_MM,
        splitHeightMm: SPLIT_MM,
        webMm: WEB_MM,
      },
    ]);
    expect(programs(loaded.project)).toEqual(programs(edited));
  }, 240_000);
});
