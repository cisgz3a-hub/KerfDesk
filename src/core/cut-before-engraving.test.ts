import { describe, expect, it } from 'vitest';
import { compileCncJob } from './cnc/compile-cnc-job';
import { cutsBeforeEngraving } from './cut-before-engraving';
import { DEFAULT_DEVICE_PROFILE } from './devices';
import { compileJob, type Job } from './job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Scene,
  type SceneObject,
  type Vec2,
} from './scene';
import { sortCutsLast } from './sort-cuts-last';

const CUT_COLOR = '#0000ff';
const ENGRAVE_COLOR = '#ff0000';
const FRAME_COLOR = '#00ff00';

function shape(
  id: string,
  color: string,
  rings: ReadonlyArray<ReadonlyArray<Vec2>>,
  closed = true,
): SceneObject {
  const points = rings.flat();
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: rings.map((ring) => ({ points: [...ring], closed })) }],
  };
}

function rectRing(x: number, y: number, width: number, height = width): Vec2[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function circleRing(cx: number, cy: number, radius: number): Vec2[] {
  return Array.from({ length: 72 }, (_, at) => {
    const angle = (at / 72) * 2 * Math.PI;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function square(id: string, color: string, minX: number, size: number, closed = true) {
  return shape(id, color, [rectRing(minX, minX, size)], closed);
}

function rect(id: string, color: string, x: number, y: number, width: number, height = width) {
  return shape(id, color, [rectRing(x, y, width, height)]);
}

const cutLayer = (settings: Partial<Layer> = {}): Layer => ({
  ...createLayer({ id: 'cut', color: CUT_COLOR }),
  name: 'Outline',
  mode: 'line',
  power: 100,
  speed: 300,
  ...settings,
});

const engraveLayer = (settings: Partial<Layer> = {}): Layer => ({
  ...createLayer({ id: 'engrave', color: ENGRAVE_COLOR }),
  name: 'Name',
  mode: 'fill',
  ...settings,
});

const frameLayer = (settings: Partial<Layer> = {}): Layer => ({
  ...createLayer({ id: 'frame', color: FRAME_COLOR }),
  name: 'Frame',
  mode: 'line',
  power: 100,
  speed: 300,
  ...settings,
});

function coaster(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { ...EMPTY_SCENE, objects, layers };
}

function findings(scene: Scene) {
  return cutsBeforeEngraving(compileJob(scene, DEFAULT_DEVICE_PROFILE));
}

const WARNED = [{ cutLayerId: 'cut', engravingLayerIds: ['engrave'] }];

const outline = square('outline', CUT_COLOR, 10, 80);
const name = square('name', ENGRAVE_COLOR, 40, 20);

// Coaster `at` of a row or grid: an 80 mm outline with a 20 mm name inside.
function coasterAt(column: number, row = 0): [SceneObject, SceneObject] {
  const x = 10 + column * 100;
  const y = 10 + row * 100;
  return [
    rect(`outline-${column}-${row}`, CUT_COLOR, x, y, 80),
    rect(`name-${column}-${row}`, ENGRAVE_COLOR, x + 30, y + 30, 20),
  ];
}

describe('cutsBeforeEngraving', () => {
  it('finds an outline cut drawn before the engraving inside it', () => {
    const scene = coaster([outline, name], [cutLayer(), engraveLayer()]);

    expect(findings(scene)).toEqual(WARNED);
  });

  it('is quiet once Sort cuts last has run', () => {
    const scene = coaster([outline, name], [cutLayer(), engraveLayer()]);

    expect(findings(sortCutsLast(scene).scene)).toEqual([]);
  });

  it('is quiet when the engraving already runs first', () => {
    expect(findings(coaster([name, outline], [engraveLayer(), cutLayer()]))).toEqual([]);
  });

  it('ignores engraving outside the outline', () => {
    const beside = square('beside', ENGRAVE_COLOR, 120, 20);

    expect(findings(coaster([outline, beside], [cutLayer(), engraveLayer()]))).toEqual([]);
  });

  it('does not call a light score frame a cut', () => {
    const scene = coaster([outline, name], [cutLayer({ power: 10, speed: 3000 }), engraveLayer()]);

    expect(findings(scene)).toEqual([]);
  });

  it('flags a lighter score line that runs after the cut inside it', () => {
    const scene = coaster(
      [outline, name],
      [cutLayer(), engraveLayer({ mode: 'line', power: 20, speed: 3000 })],
    );

    expect(findings(scene)).toEqual(WARNED);
  });

  it('ignores an open outline, which frees nothing', () => {
    const open = square('outline', CUT_COLOR, 10, 80, false);

    expect(findings(coaster([open, name], [cutLayer(), engraveLayer()]))).toEqual([]);
  });

  it('ignores a cut held by tabs', () => {
    const scene = coaster(
      [outline, name],
      [cutLayer({ tabsEnabled: true, tabsPerShape: 4, tabSizeMm: 1 }), engraveLayer()],
    );

    expect(findings(scene)).toEqual([]);
  });
});

// Rolling audit v10 V7-P2-3: one Fill operation holds every part's engraving.
describe('cutsBeforeEngraving with more than one part', () => {
  const layers = [cutLayer(), engraveLayer()];

  it('finds two coasters on one cut operation, a name in each', () => {
    const [outlineA, nameA] = coasterAt(0);
    const [outlineB, nameB] = coasterAt(1);

    expect(findings(coaster([outlineA, outlineB, nameA, nameB], layers))).toEqual(WARNED);
  });

  it('finds two coasters made coaster, name, coaster, name', () => {
    expect(findings(coaster([...coasterAt(0), ...coasterAt(1)], layers))).toEqual(WARNED);
  });

  it('finds a 2 × 2 grid of coasters', () => {
    const grid = [...coasterAt(0, 0), ...coasterAt(1, 0), ...coasterAt(0, 1), ...coasterAt(1, 1)];

    expect(findings(coaster(grid, layers))).toEqual(WARNED);
  });

  it('finds a coaster plus a label elsewhere on the same Fill', () => {
    const label = rect('label', ENGRAVE_COLOR, 150, 20, 40, 10);

    expect(findings(coaster([outline, name, label], layers))).toEqual(WARNED);
  });

  it('is quiet for two coasters after Sort cuts last', () => {
    const scene = coaster([...coasterAt(0), ...coasterAt(1)], layers);

    expect(findings(sortCutsLast(scene).scene)).toEqual([]);
  });

  it('is quiet for labels outside every coaster', () => {
    const labels = [
      rect('label-a', ENGRAVE_COLOR, 10, 100, 40, 5),
      rect('label-b', ENGRAVE_COLOR, 110, 100, 40, 5),
    ];
    const outlines = [coasterAt(0)[0], coasterAt(1)[0]];

    expect(findings(coaster([...outlines, ...labels], layers))).toEqual([]);
  });

  it('finds a large grid quickly enough for Job Review', () => {
    const grid = Array.from({ length: 64 }, (_, at) =>
      coasterAt(at % 8, Math.floor(at / 8)),
    ).flat();
    const job = compileJob(coaster(grid, layers), DEFAULT_DEVICE_PROFILE);
    const started = performance.now();

    expect(cutsBeforeEngraving(job)).toEqual(WARNED);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('cutsBeforeEngraving at the edge of a cut', () => {
  const layers = [cutLayer(), engraveLayer()];

  it('is quiet for a label that only touches the outline from outside', () => {
    const touching = rect('touching', ENGRAVE_COLOR, 90, 40, 20, 10);

    expect(findings(coaster([outline, touching], layers))).toEqual([]);
  });

  it('is quiet for an engraving across the outline, even where its rows inside are whole', () => {
    // Every scan row below y = 90 lies inside the coaster, every row above it
    // outside: one piece, which the cut does not hold.
    const across = rect('across', ENGRAVE_COLOR, 40, 80, 20, 20);

    expect(findings(coaster([outline, across], layers))).toEqual([]);
  });

  it('is quiet for an engraving across a round coaster whose centre is inside', () => {
    const round = shape('round', CUT_COLOR, [circleRing(50, 50, 40)]);
    const across = rect('across', ENGRAVE_COLOR, 72, 72, 12);

    expect(findings(coaster([round, across], layers))).toEqual([]);
  });

  it('finds a name in a round coaster whose box corners poke past the curve', () => {
    const round = shape('round', CUT_COLOR, [circleRing(50, 50, 40)]);
    const wide = shape('wide', ENGRAVE_COLOR, [
      [
        { x: 15, y: 45 },
        { x: 50, y: 30 },
        { x: 85, y: 45 },
        { x: 85, y: 55 },
        { x: 50, y: 70 },
        { x: 15, y: 55 },
      ],
    ]);

    expect(findings(coaster([round, wide], layers))).toEqual(WARNED);
  });

  it('finds an engraving that follows a U-shaped part, and not a bar across its arms', () => {
    const u = (inset: number): Vec2[] => [
      { x: 10 + inset, y: 10 + inset },
      { x: 90 - inset, y: 10 + inset },
      { x: 90 - inset, y: 90 - inset },
      { x: 70 + inset, y: 90 - inset },
      { x: 70 + inset, y: 30 - inset },
      { x: 30 - inset, y: 30 - inset },
      { x: 30 - inset, y: 90 - inset },
      { x: 10 + inset, y: 90 - inset },
    ];
    const part = shape('part', CUT_COLOR, [u(0)]);
    // The inset U's box centre lies in the gap between the arms.
    const follows = shape('follows', ENGRAVE_COLOR, [u(5)]);
    const bar = rect('bar', ENGRAVE_COLOR, 15, 60, 70, 5);

    expect(findings(coaster([part, follows], layers))).toEqual(WARNED);
    expect(findings(coaster([part, bar], layers))).toEqual([]);
  });

  it('is quiet for a score that runs along the cut line', () => {
    const along = square('along', ENGRAVE_COLOR, 10, 80);
    const score = engraveLayer({ mode: 'line', power: 20, speed: 3000 });

    expect(findings(coaster([outline, along], [cutLayer(), score]))).toEqual([]);
  });

  it('finds an engraving that covers the whole cut-free face', () => {
    const face = square('face', ENGRAVE_COLOR, 10, 80);

    expect(findings(coaster([outline, face], layers))).toEqual(WARNED);
  });
});

describe('cutsBeforeEngraving with holes and nested cuts', () => {
  const layers = [cutLayer(), engraveLayer()];
  // A coaster with a 20 mm hole cut out of its middle.
  const holed = shape('holed', CUT_COLOR, [rectRing(10, 10, 80), rectRing(40, 40, 20)]);

  it('finds a name on the part around a hole', () => {
    const onPart = rect('on-part', ENGRAVE_COLOR, 20, 20, 15, 5);

    expect(findings(coaster([holed, onPart], layers))).toEqual(WARNED);
  });

  it('finds an engraving inside a cut hole, whose slug is cut free first', () => {
    // As #1561's v10 refuter ruled: the slug drops before it is engraved.
    const inHole = rect('in-hole', ENGRAVE_COLOR, 45, 45, 10);

    expect(findings(coaster([holed, inHole], layers))).toEqual(WARNED);
  });

  it('finds an engraving with a hole of its own inside the coaster', () => {
    const donut = shape('donut', ENGRAVE_COLOR, [rectRing(30, 30, 40), rectRing(40, 40, 20)]);

    expect(findings(coaster([outline, donut], layers))).toEqual(WARNED);
  });

  it('finds two coasters inside one big outer cut', () => {
    const big = rect('big', CUT_COLOR, 0, 0, 200, 100);

    expect(findings(coaster([big, ...coasterAt(0), ...coasterAt(1)], layers))).toEqual(WARNED);
  });

  it('names both cut operations when a frame and the coasters each run before the names', () => {
    const big = rect('big', FRAME_COLOR, 0, 0, 200, 100);
    const scene = coaster(
      [big, ...coasterAt(0), ...coasterAt(1)],
      [frameLayer(), cutLayer(), engraveLayer()],
    );

    expect(findings(scene)).toEqual([
      { cutLayerId: 'frame', engravingLayerIds: ['engrave'] },
      { cutLayerId: 'cut', engravingLayerIds: ['engrave'] },
    ]);
  });
});

describe('cutsBeforeEngraving with several cut operations', () => {
  it('is quiet when the inner cut runs before the outer one on purpose', () => {
    const inner = rect('inner', FRAME_COLOR, 40, 40, 20);
    const scene = coaster([inner, outline], [frameLayer({ power: 80 }), cutLayer()]);

    expect(findings(scene)).toEqual([]);
  });

  it('is quiet for an equal cut inside an earlier one, as Sort cuts last measures it', () => {
    const inner = rect('inner', FRAME_COLOR, 40, 40, 20);
    const scene = coaster([outline, inner], [cutLayer(), frameLayer()]);

    expect(findings(scene)).toEqual([]);
  });

  it('names only the cut operation that holds the engraving', () => {
    const elsewhere = rect('elsewhere', FRAME_COLOR, 200, 10, 80);
    const scene = coaster([elsewhere, outline, name], [frameLayer(), cutLayer(), engraveLayer()]);

    expect(findings(scene)).toEqual(WARNED);
  });

  it('is quiet when every engraving runs before the cut that holds it', () => {
    const elsewhere = rect('elsewhere', FRAME_COLOR, 200, 10, 80);
    const scene = coaster([name, outline, elsewhere], [engraveLayer(), cutLayer(), frameLayer()]);

    expect(findings(scene)).toEqual([]);
  });
});

describe('cutsBeforeEngraving on CNC', () => {
  it('leaves CNC to its own rule: profiles always run after pockets', () => {
    const cnc = (id: string, color: string, cutType: 'profile-outside' | 'pocket'): Layer => ({
      ...createLayer({ id, color }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, tabsEnabled: false },
    });
    const scene = coaster(
      [...coasterAt(0), ...coasterAt(1)],
      [cnc('cut', CUT_COLOR, 'profile-outside'), cnc('engrave', ENGRAVE_COLOR, 'pocket')],
    );
    const job: Job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);

    expect(job.groups.length).toBeGreaterThan(0);
    expect(job.groups.every((group) => group.kind === 'cnc')).toBe(true);
    expect(cutsBeforeEngraving(job)).toEqual([]);
  });
});
