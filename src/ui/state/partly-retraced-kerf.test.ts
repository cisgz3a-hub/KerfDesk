// @vitest-environment jsdom
// Tools audit T1, T35-P2-1, T35R-P2-1 and T35R-P2-2 (ADR-486 Amendment 5).
// A closed contour that encloses area only in part ("P" closed down its own
// stem, a stick with a loop at its end, a closing line a hair beside the stem)
// kept only that part under Kerf Offset, and the rest vanished from the G-code
// with nothing in Job Review. Every burn is read back from the emitted G-code
// by an independent decoder (retraced-paths.test-support.ts); the oracle is
// hand geometry: the closed ring's even-odd region is only its bowl or loop,
// 4 × (side + 2 × kerf) of outline.
import { beforeEach, describe, expect, it } from 'vitest';
import { closeOpenPaths } from '../../core/geometry/path-direction-edits';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { textToPolylines } from '../../core/text/text-to-polylines';
import { parseDxf } from '../../io/dxf';
import { burnOf } from './retraced-paths.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

const p = (x: number, y: number): Vec2 => ({ x, y });
const art = (id: string, polylines: ReadonlyArray<Polyline>): SceneObject =>
  ({
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    paths: [{ color: '#ff0000', polylines }],
  }) as ImportedSvg;
const open = (id: string, points: ReadonlyArray<Vec2>, closed = false) =>
  art(id, [{ points: [...points], closed }]);

// The closing line (0,25)→(0,0) runs down the lower 25 mm of the stem.
const P = [p(0, 0), p(0, 50), p(25, 50), p(25, 25), p(0, 25)];
// The closing line (0,30)→(0,60) runs up the upper 30 mm of the stem.
const B = [p(0, 60), p(0, 0), p(20, 0), p(20, 30), p(0, 30)];
// A 40 mm stick, a 20 × 20 loop, the stick back; the ends already meet.
const LOLLIPOP = [
  p(0, 0),
  p(40, 0),
  p(40, -10),
  p(60, -10),
  p(60, 10),
  p(40, 10),
  p(40, 0),
  p(0, 0),
];
// The "P" whose end lands 0.05 mm beside the stem.
const P_NEAR = [p(0, 0), p(0, 50), p(25, 50), p(25, 25), p(0.05, 25)];

function project(objects: ReadonlyArray<SceneObject>, kerfOffsetMm: number): Project {
  const base = createProject();
  const cut: Layer = {
    ...createLayer({ id: 'L', color: '#ff0000', name: 'Cut', mode: 'line' }),
    speed: 600,
    power: 80,
    kerfOffsetMm,
  };
  return {
    ...base,
    optimization: { ...DEFAULT_PROJECT_OPTIMIZATION },
    scene: { ...base.scene, objects: [...objects], layers: [cut], groups: [] },
  };
}

function closeWithClosePath(object: SceneObject, kerfOffsetMm: number): void {
  useStore.setState({
    project: project([object], kerfOffsetMm),
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
  });
  st().closeSelectedPaths();
}

const DROPPED = (name: string, mm: string) =>
  new RegExp(
    `Kerf offset on layer "Cut" cut only part of 1 closed path: about ${mm} mm of line in "${name}" is missing from the job and will NOT be cut`,
  );

describe('Close Path over its own stroke: the kerf names what it drops (T35-P2-1)', () => {
  const cases: Array<[string, ReadonlyArray<Vec2>, number, number, string]> = [
    // name, points, open burn, kept outline at |kerf| 0.1 (± 0.8 per side), dropped
    ['P', P, 125, 100, '25'],
    ['b', B, 130, 100, '30'],
    ['lollipop', LOLLIPOP, 160, 80, '40'],
  ];
  for (const [name, points, before, kept, dropped] of cases) {
    for (const kerf of [0.1, -0.1, 0.001]) {
      it(`"${name}" at kerf ${kerf}: Job Review says about ${dropped} mm is not cut`, () => {
        expect(burnOf(project([open(name, points)], kerf)).total).toBeCloseTo(before, 3);
        closeWithClosePath(open(name, points), kerf);
        expect(st().project.scene.objects[0]).toMatchObject({
          paths: [{ polylines: [{ closed: true }] }],
        });
        const burn = burnOf(st().project);
        // The loss itself is unchanged: only the bowl or loop is cut.
        expect(burn.total).toBeCloseTo(kept + 8 * kerf, 3);
        expect(burn.warnings.join(' ')).toMatch(DROPPED(name, dropped));
        expect(burn.warnings.join(' ')).not.toMatch(/no area|closed up|shrank/);
      });
    }
  }

  it('Close Path warns in its toast that the closing line runs back over the stem', () => {
    closeWithClosePath(open('P', P), 0.1);
    expect(lastToast()?.variant).toBe('warning');
    expect(lastToast()?.message).toMatch(
      /^Closed 1 path\. The widest gap closed was 25 mm\. 1 closed path runs back over about 25 mm of its own line: Kerf Offset cuts only the part that encloses area/,
    );
  });

  it('Close Paths with Tolerance warns the same way', () => {
    useStore.setState({
      project: project([open('P', P)], 0.1),
      selectedObjectId: 'P',
      additionalSelectedIds: new Set(),
    });
    st().closeSelectedPathsWithTolerance(30, 'bridge');
    expect(lastToast()?.variant).toBe('warning');
    expect(lastToast()?.message).toContain('runs back over about 25 mm of its own line');
  });

  it('a plain open shape closes with the usual info toast', () => {
    closeWithClosePath(open('L', [p(0, 0), p(30, 0), p(30, 20)]), 0.1);
    expect(lastToast()?.variant).toBe('info');
    expect(lastToast()?.message).not.toContain('runs back over');
  });

  it('a pure out-and-back path still stays open and burns as drawn', () => {
    const outAndBack = open('r', [p(0, 0), p(30, 0), p(10, 0)]);
    closeWithClosePath(outAndBack, 0.1);
    expect(lastToast()?.message).toContain('1 path runs back over itself, so it stays open');
    const burn = burnOf(st().project);
    expect(burn.total).toBeCloseTo(50, 3);
    expect(burn.warnings).toEqual([]);
  });
});

describe('A closing line beside the stem, on the shrinking side (T35R-P2-2)', () => {
  it('kerf −0.1 drops the 0.05 mm sliver and names about 25 mm', () => {
    const burn = burnOf(project([open('P', P_NEAR, true)], -0.1));
    expect(burn.total).toBeCloseTo(99.2, 3);
    expect(burn.warnings.join(' ')).toMatch(DROPPED('P', '2[45]'));
  });

  it('kerf +0.1 keeps the sliver as a thin ring, and says nothing', () => {
    const burn = burnOf(project([open('P', P_NEAR, true)], 0.1));
    expect(burn.total).toBeGreaterThan(150);
    expect(burn.warnings).toEqual([]);
  });
});

describe('DXF import leaves a lollipop LWPOLYLINE open (T35R-P2-1)', () => {
  const lollipop = [
    ['0', 'LWPOLYLINE', '8', '0', '90', '8', '70', '0'],
    [
      [0, 0],
      [40, 0],
      [40, -10],
      [60, -10],
      [60, 10],
      [40, 10],
      [40, 0],
      [0, 0],
    ].flatMap(([x, y]) => ['10', `${x}`, '20', `${y}`]),
  ];
  const square = [
    ['0', 'LWPOLYLINE', '8', '0', '90', '5', '70', '0'],
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ].flatMap(([x, y]) => ['10', `${x}`, '20', `${y}`]),
  ];
  const dxf = (entities: ReadonlyArray<ReadonlyArray<string>>) =>
    [
      ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'],
      ...['0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF'],
    ].join('\n');
  const imported = (entities: ReadonlyArray<ReadonlyArray<string>>) => {
    const parsed = parseDxf({ dxfText: dxf(entities), id: 'dxf', source: 'lollipop.dxf' });
    if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('import failed');
    return { ...parsed.object, operationIds: ['L'] } as SceneObject;
  };
  const closedFlags = (object: SceneObject) =>
    'paths' in object ? object.paths.flatMap((path) => path.polylines.map((pl) => pl.closed)) : [];

  for (const kerf of [0.1, -0.1]) {
    it(`kerf ${kerf}: imports open and burns its 160 mm`, () => {
      const object = imported(lollipop);
      expect(closedFlags(object)).toEqual([false]);
      const burn = burnOf(project([object], kerf));
      expect(burn.total).toBeCloseTo(160, 3);
      expect(burn.warnings).toEqual([]);
    });
  }

  it('a square whose ends meet still closes', () => {
    expect(closedFlags(imported(square))).toEqual([true]);
  });
});

describe('No warning where the offset keeps every line', () => {
  const frame = [p(0, 0), p(60, 0), p(60, 40), p(0, 40)];
  // A 30° V-notch, 20 mm deep, cut into the frame's top edge.
  const notched = [p(0, 0), p(60, 0), p(60, 40), p(35.36, 40), p(30, 20), p(24.64, 40), p(0, 40)];
  const circle = Array.from({ length: 180 }, (_, i) =>
    p(30 + 20 * Math.cos((i * Math.PI) / 90), 20 + 20 * Math.sin((i * Math.PI) / 90)),
  );
  const shapes: Array<[string, ReadonlyArray<Vec2>]> = [
    ['a frame', frame],
    ['a frame with a 30° notch', notched],
    ['a circle', circle],
  ];
  for (const [name, points] of shapes) {
    for (const kerf of [0.1, -0.1, 0.5]) {
      it(`${name} at kerf ${kerf}`, () => {
        expect(burnOf(project([open('s', points, true)], kerf)).warnings).toEqual([]);
      });
    }
  }

  it('a 0.05 mm slot is still a hole that closes up, not a part dropped', () => {
    const slot = open('slot', [p(10, 12), p(40, 12), p(40, 12.05), p(10, 12.05)], true);
    const warnings = burnOf(project([open('frame', frame, true), slot], 0.1)).warnings.join(' ');
    expect(warnings).toMatch(/closed up 1 hole or slot/);
    expect(warnings).not.toMatch(/cut only part/);
  });
});

describe('Single-line glyphs after Convert to Path and Close Path (T35-P2-1)', () => {
  const glyph = async (fontKey: string, content: string): Promise<ReadonlyArray<ColoredPath>> => {
    const rendered = await textToPolylines({
      geometry: 'single-line',
      fontKey,
      content,
      sizeMm: 20,
      alignment: 'left',
      lineHeight: 1.2,
      color: '#ff0000',
    } as never);
    return closeOpenPaths(rendered.paths, IDENTITY_TRANSFORM).paths;
  };
  const glyphArt = (paths: ReadonlyArray<ColoredPath>) =>
    ({
      kind: 'imported-svg',
      id: 'g',
      name: 'Glyph',
      source: 'g.svg',
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
      paths: paths.map((path) => ({ ...path, color: '#ff0000' })),
    }) as ImportedSvg;

  const cases: Array<[string, string, number]> = [
    ['ems-nixish', 'H', 0.1],
    ['relief-single-line', 'P', 0.1],
    ['ems-casual-hand', 'P', -0.1],
  ];
  for (const [font, letter, kerf] of cases) {
    it(`${font} "${letter}" at kerf ${kerf} is named in Job Review`, async () => {
      const burn = burnOf(project([glyphArt(await glyph(font, letter))], kerf));
      expect(burn.warnings.join(' ')).toMatch(
        /cut only part of \d+ closed paths?: about .* in "Glyph"/,
      );
    });
  }
});
