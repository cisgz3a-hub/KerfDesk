// Tools audit T1, T30-P1-2 (re-graded P2) and T30R-P2-1 (ADR-486 Amendment 4).
// A line drawn twice, or a path out and back over itself, was closed by Join
// paths, DXF import and Close Path into a loop with no area. Kerf Offset reads
// closed contours by the even-odd rule, which has no region for such a loop, so
// the cut vanished from the G-code at any non-zero kerf while the canvas still
// showed the line, silently when the offset grew it. The oracle is the burn
// before the edit: a 30 mm slit drawn twice burns 60 mm, read back from the
// emitted G-code by an independent decoder.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { parseDxf } from '../../io/dxf';
import { burnOf, type Box } from './retraced-paths.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

// The frame sits at scene x 20–80, y 20–50; the slit at y 32, x 30–60.
const INTERIOR: Box = { minX: 21.5, minY: 21.5, maxX: 78.5, maxY: 48.5 };
const EVERYWHERE: Box = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

const art = (id: string, polylines: ReadonlyArray<Polyline>): SceneObject =>
  ({
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 30 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    paths: [{ color: '#ff0000', polylines }],
  }) as ImportedSvg;

const p = (x: number, y: number) => ({ x, y });
const frame = () =>
  art('frame', [{ points: [p(0, 0), p(60, 0), p(60, 30), p(0, 30)], closed: true }]);
const slit = (id: string, reversed = false) =>
  art(id, [{ points: reversed ? [p(40, 12), p(10, 12)] : [p(10, 12), p(40, 12)], closed: false }]);
const outAndBack = (closed = false) =>
  art('r', [{ points: [p(10, 12), p(40, 12), p(10, 12)], closed }]);

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

function load(objects: ReadonlyArray<SceneObject>, kerfOffsetMm: number, ids: string[]): void {
  useStore.setState({
    project: project(objects, kerfOffsetMm),
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    undoStack: [],
    redoStack: [],
  });
}

const closedFlags = () =>
  st().project.scene.objects.flatMap((object) =>
    'paths' in object ? object.paths.flatMap((path) => path.polylines.map((pl) => pl.closed)) : [],
  );

describe('Join paths leaves a retraced chain open (T30-P1-2)', () => {
  const layouts: Array<[string, () => SceneObject[], string[]]> = [
    ['a slit drawn twice', () => [frame(), slit('a'), slit('b')], ['frame', 'a', 'b']],
    [
      'a slit drawn twice, once reversed',
      () => [frame(), slit('a'), slit('b', true)],
      ['frame', 'a', 'b'],
    ],
    ['a slit out and back in one path', () => [frame(), outAndBack()], ['frame', 'r']],
  ];
  for (const [name, make, ids] of layouts) {
    for (const kerf of [0.1, -0.1, 0.001]) {
      it(`${name}, kerf ${kerf}: still burns its 60 mm after Join`, () => {
        load(make(), kerf, ids);
        expect(burnOf(st().project).inside(INTERIOR)).toBeCloseTo(60, 3);
        st().joinSelectedPaths(0.05);
        // Only the frame is closed; the slit stays open and burns as drawn.
        expect(closedFlags().filter(Boolean)).toHaveLength(1);
        expect(burnOf(st().project).inside(INTERIOR)).toBeCloseTo(60, 3);
      });
    }
  }
});

describe('DXF import leaves a doubled LINE open (T30R-P2-1)', () => {
  const line = (x0: number, y0: number, x1: number, y1: number) => [
    '0',
    'LINE',
    '8',
    '0',
    '10',
    `${x0}`,
    '20',
    `${y0}`,
    '30',
    '0',
    '11',
    `${x1}`,
    '21',
    `${y1}`,
    '31',
    '0',
  ];
  const outAndBackPolyline = [
    ['0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '0'],
    ['10', '10', '20', '12', '10', '40', '20', '12', '10', '10', '20', '12'],
  ];
  const dxf = (entities: ReadonlyArray<ReadonlyArray<string>>) =>
    [
      ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'],
      ...['0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF'],
    ].join('\n');
  const frameLines = [
    line(0, 0, 60, 0),
    line(60, 0, 60, 30),
    line(60, 30, 0, 30),
    line(0, 30, 0, 0),
  ];
  const cases: Array<[string, ReadonlyArray<ReadonlyArray<string>>]> = [
    ['two coincident LINEs', [...frameLines, line(10, 12, 40, 12), line(10, 12, 40, 12)]],
    ['two LINEs, one reversed', [...frameLines, line(10, 12, 40, 12), line(40, 12, 10, 12)]],
    ['an LWPOLYLINE out and back', [...frameLines, ...outAndBackPolyline]],
  ];
  for (const [name, entities] of cases) {
    for (const kerf of [0.1, -0.1]) {
      it(`${name}, kerf ${kerf}: imports open and burns 60 mm`, () => {
        const parsed = parseDxf({ dxfText: dxf(entities), id: 'dxf', source: 'doubled.dxf' });
        if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('import failed');
        const imported = { ...parsed.object, operationIds: ['L'] } as SceneObject;
        const polylines = parsed.object.paths.flatMap((path) => path.polylines);
        // The frame of four LINEs still closes on import.
        expect(polylines.filter((pl) => pl.closed)).toHaveLength(1);
        expect(polylines.filter((pl) => pl.closed && pl.points.length < 3)).toHaveLength(0);
        // The kerf frame burns 180 ± 0.8 mm; the slit adds its 60 mm (0 before).
        expect(burnOf(project([imported], kerf)).total).toBeGreaterThan(235);
      });
    }
  }

  it('an LWPOLYLINE out and back on two half-circle bulges is a circle and still closes', () => {
    const circle = [
      ['0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '0'],
      [
        '10',
        '10',
        '20',
        '12',
        '42',
        '1',
        '10',
        '40',
        '20',
        '12',
        '42',
        '1',
        '10',
        '10',
        '20',
        '12',
      ],
    ];
    const parsed = parseDxf({ dxfText: dxf(circle), id: 'dxf', source: 'circle.dxf' });
    if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('import failed');
    const polylines = parsed.object.paths.flatMap((path) => path.polylines);
    expect(polylines.map((pl) => pl.closed)).toEqual([true]);
  });
});

describe('Close Path leaves an out-and-back path open (T30R-P2-1)', () => {
  const routes: Array<[string, () => void]> = [
    ['Close Path', () => st().closeSelectedPaths()],
    [
      'Close Paths with Tolerance, bridge',
      () => st().closeSelectedPathsWithTolerance(0.05, 'bridge'),
    ],
    [
      'Close Paths with Tolerance, move ends',
      () => st().closeSelectedPathsWithTolerance(0.05, 'move-ends'),
    ],
  ];
  for (const [name, run] of routes) {
    it(`${name}: says why, and the kerf +0.1 burn keeps 60 mm`, () => {
      load([frame(), outAndBack()], 0.1, ['r']);
      run();
      expect(closedFlags()).toEqual([true, false]);
      expect(toasts().join(' ')).toContain('1 path runs back over itself, so it stays open');
      expect(burnOf(st().project).inside(INTERIOR)).toBeCloseTo(60, 3);
    });
  }

  it('still closes a real open shape beside it', () => {
    const open = art('o', [{ points: [p(5, 5), p(25, 5), p(25, 20)], closed: false }]);
    load([outAndBack(), open], 0, ['r', 'o']);
    st().closeSelectedPaths();
    expect(closedFlags()).toEqual([false, true]);
    expect(toasts().join(' ')).toContain('Closed 1 path.');
  });
});

describe('Kerf Offset names a closed contour with no area on either side (T30R-P2-1)', () => {
  const NO_AREA = /dropped 1 closed path that encloses no area.*will NOT be cut/;
  for (const kerf of [0.1, -0.1]) {
    it(`standalone, kerf ${kerf}: the loss is in Job Review`, () => {
      const burn = burnOf(project([outAndBack(true)], kerf));
      expect(burn.inside(EVERYWHERE)).toBe(0);
      expect(burn.warnings.join(' ')).toMatch(NO_AREA);
    });
    it(`inside a part, kerf ${kerf}: named as no area, not as a hole that closed up`, () => {
      const burn = burnOf(project([frame(), outAndBack(true)], kerf));
      expect(burn.inside(INTERIOR)).toBe(0);
      expect(burn.warnings.join(' ')).toMatch(NO_AREA);
      expect(burn.warnings.join(' ')).not.toMatch(/closed up|shrank/);
    });
  }

  it('says nothing without a kerf, where the loop burns as drawn', () => {
    const burn = burnOf(project([outAndBack(true)], 0));
    expect(burn.inside(EVERYWHERE)).toBeCloseTo(60, 3);
    expect(burn.warnings.join(' ')).not.toMatch(/no area/);
  });

  it('a 0.05 mm slot is still a hole that closes up, not a contour with no area', () => {
    const slot = art('s', [
      { points: [p(10, 12), p(40, 12), p(40, 12.05), p(10, 12.05)], closed: true },
    ]);
    const warnings = burnOf(project([frame(), slot], 0.1)).warnings.join(' ');
    expect(warnings).toMatch(/closed up 1 hole or slot/);
    expect(warnings).not.toMatch(/no area/);
  });
});
