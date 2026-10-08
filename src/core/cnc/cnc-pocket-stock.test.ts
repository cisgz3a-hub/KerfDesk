import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Polyline,
} from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileCncJob } from './compile-cnc-job';
import { pointInPolygon } from '../geometry';
import { predictCnc2dStock } from './cnc-pocket-stock';
import { planRestPocketResidualToolpaths } from './rest-pocket';
import { resolveRestPocketOperation } from './cnc-rest-operation';
import { normalizeCncPocketRestStock } from './cnc-pocket-rest-stock-settings';

function box(x: number, y: number, size: number): Polyline {
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
const ROUGH: CncTool = { id: 'rough', name: '8 mm rough cutter', kind: 'end-mill', diameterMm: 8 };
const FINISH: CncTool = {
  id: 'finish',
  name: '2 mm finish cutter',
  kind: 'end-mill',
  diameterMm: 2,
};
const CONFIG = { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: FINISH.id, tools: [ROUGH, FINISH] };
const SETTINGS = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'pocket' as const,
  pocketRoughToolId: ROUGH.id,
  depthMm: 2,
  stageRecipes: {
    'pocket-rough': {
      toolId: ROUGH.id,
      feedMmPerMin: 500,
      plungeMmPerMin: 150,
      spindleRpm: 12000,
      depthPerPassMm: 0.6,
    },
  },
  pocketRestStock: {
    kind: 'rough-stage-stock' as const,
    previousToolId: ROUGH.id,
    previousToolDiameterMm: 8,
    toleranceMm: 0.01,
  },
};
function inside(point: { x: number; y: number }, contours: ReadonlyArray<Polyline>): boolean {
  return contours.reduce(
    (value, contour) => (pointInPolygon(point, contour.points) ? !value : value),
    false,
  );
}

describe('stock-aware 2D rest against actual planned routes', () => {
  it('keeps a missing route in predicted stock instead of treating every reachable point as removed', () => {
    const source = [box(0, 0, 30)];
    const partial = [
      {
        closed: false,
        points: [
          { x: 4, y: 4 },
          { x: 26, y: 4 },
        ],
      },
    ];
    const stock = predictCnc2dStock(source, partial, ROUGH, 2, 0.01);
    expect(stock.ok).toBe(true);
    if (!stock.ok) throw new Error(stock.reason);
    expect(inside({ x: 15, y: 15 }, stock.residualContours)).toBe(true);
    expect(inside({ x: 15, y: 4 }, stock.residualContours)).toBe(false);
    expect(stock.evidence.removedAreaMm2).toBeLessThan(250);
    expect(stock.evidence.residualAreaMm2).toBeGreaterThan(650);
    const rest = planRestPocketResidualToolpaths(source, stock.residualContours, 2, 40);
    if (!rest.ok) throw new Error(rest.reason);
    expect(rest.completion).toBe('complete');
    expect(rest.toolpaths.some((path) => path.points.some((point) => point.y > 15))).toBe(true);
  });

  it('preserves protected islands in both stock subtraction and finish centre routes', () => {
    const contours = [box(0, 0, 30), box(10, 10, 10)];
    const result = resolveRestPocketOperation(contours, SETTINGS, CONFIG);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.stockEvidence?.sourceKind).toBe('planned-rough-stage');
    expect(result.stockEvidence?.removedAreaMm2).toBeGreaterThan(500);
    for (const path of result.restToolpaths)
      for (const point of path.points) expect(inside(point, contours)).toBe(true);
  });

  it('binds source signatures to route, cutter and depth rather than a catalogue name', () => {
    const source = [box(0, 0, 30)],
      routes = [box(4, 4, 22)];
    const signatures = [
      predictCnc2dStock(source, routes, ROUGH, 2, 0.01),
      predictCnc2dStock(source, [box(5, 5, 20)], ROUGH, 2, 0.01),
      predictCnc2dStock(source, routes, { ...ROUGH, diameterMm: 7 }, 2, 0.01),
      predictCnc2dStock(source, routes, ROUGH, 1, 0.01),
    ].map((stock) => (stock.ok ? stock.evidence.sourceSignature : stock.reason));
    expect(new Set(signatures).size).toBe(4);
  });

  it('invalidates a changed cutter snapshot and emits a disclosed full finishing pocket', () => {
    const changed = { ...CONFIG, tools: [{ ...ROUGH, diameterMm: 7 }, FINISH] };
    const result = resolveRestPocketOperation([box(0, 0, 30)], SETTINGS, changed);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.stockEvidence).toBeUndefined();
    expect(result.roughToolpaths).toEqual([]);
    expect(result.restToolpaths.length).toBeGreaterThan(10);
    expect(result.findings?.join(' ')).toContain('cutter changed');
    expect(result.findings?.join(' ')).toContain('No previous-stock subtraction');
  });

  it.each([
    { pocketStrategy: 'adaptive' as const },
    { rampEntryDeg: 3 },
    { helixEntry: { minDiameterMm: 1, maxDiameterMm: 4, angleDeg: 3 } },
  ])('discloses unsupported stock interactions %j with executable fallback', (patch) => {
    const result = resolveRestPocketOperation([box(0, 0, 30)], { ...SETTINGS, ...patch }, CONFIG);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.restToolpaths.length).toBeGreaterThan(0);
    expect(result.stockEvidence).toBeUndefined();
    expect(result.findings?.join(' ')).toContain('Full offset-pocket fallback');
  });

  it('keeps previous-route evidence on the actual compiled finishing group', () => {
    const contours = [box(0, 0, 30), box(10, 10, 10)];
    const job = compileCncJob(
      {
        objects: [
          {
            kind: 'imported-svg',
            id: 'stock-source',
            source: 'stock.svg',
            bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
            transform: IDENTITY_TRANSFORM,
            paths: [{ color: '#000000', polylines: contours }],
          },
        ],
        layers: [{ ...createLayer({ id: 'stock-layer', color: '#000000' }), cnc: SETTINGS }],
      },
      DEFAULT_DEVICE_PROFILE,
      CONFIG,
    );
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups).toHaveLength(2);
    const rough = groups.find((group) => group.toolId === ROUGH.id),
      finish = groups.find((group) => group.toolId === FINISH.id);
    expect(rough?.cuttingStage).toBe('pocket-rough');
    expect(rough?.restStock).toBeUndefined();
    expect(finish?.restStock).toMatchObject({
      sourceKind: 'planned-rough-stage',
      previousToolId: ROUGH.id,
      previousToolDiameterMm: 8,
      depthMm: 2,
      toleranceMm: 0.01,
    });
    expect(finish?.restStock?.sourceSignature).toMatch(/^2d-stock-v1-/);
    expect(finish?.passes.length).toBeGreaterThan(0);
  });

  it('includes the emitted closing edge in a closed rough route sweep', () => {
    const stock = predictCnc2dStock([box(0, 0, 30)], [box(4, 4, 22)], ROUGH, 2, 0.01);
    if (!stock.ok) throw new Error(stock.reason);
    expect(inside({ x: 4, y: 15 }, stock.residualContours)).toBe(false);
    expect(inside({ x: 15, y: 15 }, stock.residualContours)).toBe(true);
  });

  it.each([
    { ...CONFIG, tools: [FINISH] },
    { ...CONFIG, tools: [{ ...ROUGH, kind: 'ball-nose' as const }, FINISH] },
  ])(
    'keeps an executable full pocket when the retained prior cutter is unavailable: %j',
    (config) => {
      const result = resolveRestPocketOperation([box(0, 0, 30)], SETTINGS, config);
      if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
      expect(result.roughToolpaths).toEqual([]);
      expect(result.restToolpaths.length).toBeGreaterThan(0);
      expect(result.stockEvidence).toBeUndefined();
      expect(result.findings?.join(' ')).toContain('missing, unselected');
    },
  );
  it('keeps malformed or over-budget coverage unknown', () => {
    expect(
      predictCnc2dStock(
        [box(0, 0, 30)],
        [{ closed: false, points: [{ x: NaN, y: 4 }] }],
        ROUGH,
        2,
        0.01,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('coverage is unknown') });
    expect(
      normalizeCncPocketRestStock({ ...SETTINGS.pocketRestStock, toleranceMm: 0.0001 }),
    ).toBeUndefined();
    expect(
      predictCnc2dStock(
        [box(0, 0, 30)],
        Array.from({ length: 4096 }, () => box(4, 4, 22)),
        ROUGH,
        2,
        0.01,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('budget; coverage is unknown') });
    expect(normalizeCncPocketRestStock(SETTINGS.pocketRestStock)).toEqual(SETTINGS.pocketRestStock);
  });
});
