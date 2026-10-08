import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type LayerOperationSettings,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import { compileJob } from './compile-job';
import type { Job } from './job';
import { optimizePaths } from './optimize-paths';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  laserArcMoves: 'off' as const,
  bedWidth: 200,
  bedHeight: 200,
};
const color = '#000000';
const settings = {
  travelPolicy: 'nearest-neighbor',
  insideFirst: true,
  layerPriority: 'project-order',
  pathDirection: 'allow-reverse',
  startPoint: 'machine-origin',
} as const;
type Rectangle = { id: string; depth: number; x: number; y: number; width: number; height: number };
const rectangle = (x: number, y: number, width: number, height = width): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});
function artwork(id: string, polylines: readonly Polyline[]): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: id + '.svg',
    bounds: { minX: 10, minY: 10, maxX: 110, maxY: 110 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color, polylines }],
  };
}
function layer(extra: Partial<LayerOperationSettings> = {}): Layer {
  return {
    ...createLayer({ id: 'cut', name: 'Cut', color, mode: 'line' }),
    power: 80,
    speed: 1200,
    passes: 1,
    ...extra,
  };
}
const tabs: Partial<LayerOperationSettings> = {
  tabsEnabled: true,
  tabSizeMm: 2,
  tabsPerShape: 4,
  tabSkipInnerShapes: false,
  tabCutPowerPercent: 20,
};
const perforation: Partial<LayerOperationSettings> = {
  perforationEnabled: true,
  perforationCutMm: 3,
  perforationSkipMm: 1,
};

// A 1 mm neck joins two 20 mm lobes. A 1 mm inward kerf splits this
// hole into two 18 mm squares. The separate 1 mm-wide slot disappears.
// These expected output regions are analytical, not nearest-source labels.
const dumbbell: Polyline = {
  closed: true,
  points: [
    { x: 30, y: 30 },
    { x: 50, y: 30 },
    { x: 50, y: 39.5 },
    { x: 70, y: 39.5 },
    { x: 70, y: 30 },
    { x: 90, y: 30 },
    { x: 90, y: 50 },
    { x: 70, y: 50 },
    { x: 70, y: 40.5 },
    { x: 50, y: 40.5 },
    { x: 50, y: 50 },
    { x: 30, y: 50 },
  ],
};
const compound = artwork('compound', [
  rectangle(10, 10, 100, 80),
  dumbbell,
  rectangle(60, 60, 15, 1),
  rectangle(36, 35, 6),
]);
const compensated: Rectangle[] = [
  { id: 'island', depth: 2, x: 35, y: 34, width: 8, height: 8 },
  { id: 'left-hole', depth: 1, x: 31, y: 31, width: 18, height: 18 },
  { id: 'right-hole', depth: 1, x: 71, y: 31, width: 18, height: 18 },
  { id: 'outer', depth: 0, x: 9, y: 9, width: 102, height: 82 },
];
const nested: Rectangle[] = [
  { id: 'island', depth: 2, x: 45, y: 45, width: 12, height: 12 },
  { id: 'hole', depth: 1, x: 35, y: 35, width: 40, height: 40 },
  { id: 'outer', depth: 0, x: 10, y: 10, width: 100, height: 100 },
];
function mixedObjects(): ImportedSvg[] {
  const objects = nested.map((r) => artwork(r.id, [rectangle(r.x, r.y, r.width)]));
  const byId = new Map(objects.map((object) => [object.id, object]));
  const get = (id: string): ImportedSvg => {
    const object = byId.get(id);
    if (object === undefined) throw new Error('Missing fixture ' + id);
    return object;
  };
  return [
    get('outer'),
    get('island'),
    {
      ...get('hole'),
      operationOverride: {
        byOperation: { cut: { power: 60, speed: 700, passes: 2, overcutMm: 1 } },
      },
    },
  ];
}
type Burn = {
  a: Vec2;
  b: Vec2;
  length: number;
  s: number;
  feed: number;
  pass: number;
  passes: number;
};
function updateLaserState(
  state: { s: number; feed: number; armed: boolean },
  words: ReadonlyMap<string | undefined, number>,
): void {
  const m = words.get('M');
  if (m === 3 || m === 4) state.armed = true;
  if (m === 5) state.armed = false;
  state.s = words.get('S') ?? state.s;
  state.feed = words.get('F') ?? state.feed;
}
function motionBurn(
  line: string,
  state: { head: Vec2; s: number; feed: number; armed: boolean },
  pass: number,
  passes: number,
): Burn | null {
  const words = new Map(
    [...line.matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)].map((word) => [word[1], Number(word[2])]),
  );
  updateLaserState(state, words);
  const g = words.get('G');
  if (g !== 0 && g !== 1) return null;
  const next = { x: words.get('X') ?? state.head.x, y: words.get('Y') ?? state.head.y };
  const length = Math.hypot(next.x - state.head.x, next.y - state.head.y);
  const burn =
    g === 1 && state.armed && state.s > 0 && length > 0
      ? { a: state.head, b: next, length, s: state.s, feed: state.feed, pass, passes }
      : null;
  state.head = next;
  return burn;
}
function emittedBurns(gcode: string): Burn[] {
  const burns: Burn[] = [];
  const state = { head: { x: 0, y: 0 }, s: 0, feed: 0, armed: false };
  let pass = 0,
    passes = 0;
  for (const raw of gcode.split('\n')) {
    const marker = /^; pass (\d+) of (\d+)/.exec(raw);
    if (marker !== null) {
      pass = Number(marker[1]);
      passes = Number(marker[2]);
    }
    const burn = motionBurn(raw.split(';')[0] ?? '', state, pass, passes);
    if (burn !== null) burns.push(burn);
  }
  return burns;
}
function output(
  objects: readonly SceneObject[],
  operation: Layer,
  ordering: NonNullable<Parameters<typeof optimizePaths>[1]> = settings,
) {
  const compiled = compileJob({ objects, layers: [operation] }, device);
  const optimized = optimizePaths(compiled, ordering);
  const gcode = grblStrategy.emit(optimized, device);
  expect(gcode).not.toBe('');
  expect(gcode).not.toMatch(/^G[23]\b/m);
  return { compiled, optimized, gcode, burns: emittedBurns(gcode) };
}
function regionFor(burn: Burn, regions: readonly Rectangle[]): Rectangle {
  const midpoint = { x: (burn.a.x + burn.b.x) / 2, y: (burn.a.y + burn.b.y) / 2 };
  const within = (p: Vec2, r: Rectangle): boolean =>
    p.x >= r.x - 0.002 &&
    p.x <= r.x + r.width + 0.002 &&
    p.y >= r.y - 0.002 &&
    p.y <= r.y + r.height + 0.002;
  const boundary = (p: Vec2, r: Rectangle): boolean =>
    Math.min(
      Math.abs(p.x - r.x),
      Math.abs(p.x - r.x - r.width),
      Math.abs(p.y - r.y),
      Math.abs(p.y - r.y - r.height),
    ) < 0.002;
  const region = regions.find((r) =>
    [burn.a, burn.b, midpoint].every((p) => within(p, r) && boundary(p, r)),
  );
  if (region === undefined) throw new Error('Unexpected compensated burn ' + JSON.stringify(burn));
  return region;
}
function assertInsideFirst(burns: readonly Burn[], regions: readonly Rectangle[]): void {
  const depths = burns.map((burn) => regionFor(burn, regions).depth);
  expect(depths.length).toBeGreaterThan(0);
  expect(depths).toEqual([...depths].sort((a, b) => b - a));
  expect(new Set(burns.map((burn) => regionFor(burn, regions).id))).toEqual(
    new Set(regions.map((r) => r.id)),
  );
}
function assertDistances(
  phase: readonly Burn[],
  passes: number,
  perimeter: number,
  tabbed: boolean,
  dashed: boolean,
  low: boolean,
  seamMm: number,
): void {
  for (let pass = 1; pass <= passes; pass += 1) {
    const length = phase
      .filter((burn) => burn.pass === pass)
      .reduce((total, burn) => total + burn.length, 0);
    if (low) expect(length).toBeCloseTo(8, 3);
    else if (dashed) {
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThan(perimeter - (tabbed ? 8 : 0));
    } else {
      const seam = pass === passes ? seamMm : 0;
      expect(length).toBeCloseTo(perimeter - (tabbed ? 8 : 0) + seam, 3);
    }
  }
}
function processFor(id: string, mixed: boolean) {
  if (mixed && id === 'hole') return { mainS: 600, feed: 700, passes: 2, seamMm: 1 };
  return { mainS: 800, feed: 1200, passes: mixed ? 3 : 1, seamMm: 2 };
}
function assertPasses(
  burns: readonly Burn[],
  regions: readonly Rectangle[],
  mixed: boolean,
  tabbed: boolean,
  dashed = false,
  overcut = false,
): void {
  for (const r of regions) {
    const own = burns.filter((burn) => regionFor(burn, regions).id === r.id);
    const { mainS, feed, passes, seamMm } = processFor(r.id, mixed);
    const perimeter = 2 * (r.width + r.height);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((burn) => burn.feed === feed && burn.passes === passes)).toBe(true);
    expect(new Set(own.map((burn) => burn.s))).toEqual(
      new Set(tabbed ? [mainS, mainS / 5] : [mainS]),
    );
    for (const phaseS of tabbed ? [mainS, mainS / 5] : [mainS]) {
      const phase = own.filter((burn) => burn.s === phaseS);
      expect(new Set(phase.map((burn) => burn.pass))).toEqual(
        new Set(Array.from({ length: passes }, (_, i) => i + 1)),
      );
      assertDistances(
        phase,
        passes,
        perimeter,
        tabbed,
        dashed,
        phaseS !== mainS,
        overcut ? seamMm : 0,
      );
    }
  }
}
function assertPairedContours(burns: readonly Burn[], regions: readonly Rectangle[]): void {
  const runs: string[] = [];
  for (const burn of burns) {
    const id = regionFor(burn, regions).id;
    if (runs.at(-1) !== id) runs.push(id);
  }
  expect(runs.length).toBe(new Set(runs).size);
  for (const r of regions) {
    const own = burns.filter((burn) => regionFor(burn, regions).id === r.id);
    const mainS = r.id === 'hole' ? 600 : 800;
    const firstLow = own.findIndex((burn) => burn.s < mainS);
    expect(firstLow).toBeGreaterThan(0);
    expect(own.slice(firstLow).every((burn) => burn.s === mainS / 5)).toBe(true);
  }
}
function assertClosedUp(job: Job): void {
  expect(job.diagnostics).toContainEqual({
    kind: 'kerf-offset-closed-up',
    layerName: 'Cut',
    count: 1,
    kerfOffsetMm: 1,
  });
  expect(job.diagnostics?.some((d) => d.kind === 'kerf-offset-failed')).toBe(false);
}

describe('compensated topology survives splitting, dropping and process partition', () => {
  it('control: a split dumbbell and vanished slot have four correctly offset closed survivors', () => {
    const result = output([compound], layer({ kerfOffsetMm: 1 }));
    assertClosedUp(result.compiled);
    expect(
      result.optimized.groups.flatMap((g) => (g.kind === 'cut' ? g.segments : [])),
    ).toHaveLength(4);
    assertPasses(result.burns, compensated, false, false);
    assertInsideFirst(result.burns, compensated);
  });

  it.each([
    { name: 'tabs at nonzero power', extras: tabs, tabbed: true, dashed: false },
    { name: 'perforation', extras: perforation, tabbed: false, dashed: true },
    {
      name: 'tabs and perforation',
      extras: { ...tabs, ...perforation },
      tabbed: true,
      dashed: true,
    },
  ])(
    'finishes every compensated inner survivor before the outer with $name',
    ({ extras, tabbed, dashed }) => {
      const result = output([compound], layer({ kerfOffsetMm: 1, ...extras }));
      assertClosedUp(result.compiled);
      assertPasses(result.burns, compensated, false, tabbed, dashed);
      assertInsideFirst(result.burns, compensated);
    },
  );

  it('interleaves depth 2/1/0 settings while preserving unequal passes and final-pass-only overcut', () => {
    const result = output(mixedObjects(), layer({ passes: 3, overcutMm: 2 }));
    assertPasses(result.burns, nested, true, false, false, true);
    assertInsideFirst(result.burns, nested);
  });

  it.each([
    { name: 'tabs', extras: tabs, dashed: false },
    { name: 'tabs and perforation', extras: { ...tabs, ...perforation }, dashed: true },
  ])(
    'keeps each depth 2/1/0 contour and its low-power $name paired across unequal passes',
    ({ extras, dashed }) => {
      const result = output(mixedObjects(), layer({ passes: 3, overcutMm: 2, ...extras }));
      expect(result.gcode).not.toContain('overcut ');
      assertPasses(result.burns, nested, true, true, dashed);
      assertPairedContours(result.burns, nested);
      assertInsideFirst(result.burns, nested);
    },
  );

  it('control: source-order keeps the exact compiled compound tab/perforation output', () => {
    const operation = layer({ kerfOffsetMm: 1, ...tabs, ...perforation });
    const result = output([compound], operation, { ...settings, travelPolicy: 'source-order' });
    expect(result.gcode).toBe(grblStrategy.emit(result.compiled, device));
    assertClosedUp(result.compiled);
    assertPasses(result.burns, compensated, false, true, true);
    expect(regionFor(result.burns[0]!, compensated).id).toBe('outer');
  });

  it('control: disabling inside-first preserves the nearest outer-first plan', () => {
    const result = output([compound], layer({ kerfOffsetMm: 1 }), {
      ...settings,
      insideFirst: false,
    });
    assertClosedUp(result.compiled);
    assertPasses(result.burns, compensated, false, false);
    expect(regionFor(result.burns[0]!, compensated).id).toBe('outer');
  });
});
