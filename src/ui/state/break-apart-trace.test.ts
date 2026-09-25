import { beforeEach, describe, expect, it } from 'vitest';
import { pointInPolygon } from '../../core/geometry';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  operationIdsForObject,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type TracedImage,
  type Vec2,
} from '../../core/scene';
import { selectionCanBreakApart } from '../commands/selection-command-state';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

// ADR-398: Break Apart works directly on a trace, one object per outer shape.

const TRACE_TRANSFORM = {
  x: 12.5,
  y: -4,
  scaleX: 0.25,
  scaleY: 0.3,
  rotationDeg: 30,
  mirrorX: true,
  mirrorY: false,
};

describe('Break Apart on a traced image', () => {
  beforeEach(resetStore);

  it('splits two rings with holes and a speck into three shapes that keep their holes and curves', () => {
    const trace = ringsAndSpeck();
    loadScene([sourceRaster(), trace]);
    select(trace.id);
    expect(selectionCanBreakApart(useStore.getState().project, [trace.id])).toBe(true);

    useStore.getState().breakApartSelection();

    const pieces = tracePieces();
    expect(pieces.map((piece) => piece.id)).toEqual([
      'trace__part_1',
      'trace__part_2',
      'trace__part_3',
    ]);
    const original = trace.paths[0]!;
    // Ring A (outer 0 + hole 3), ring B (outer 1 + hole 4), speck (2).
    expect(pieces.map((piece) => piece.paths[0]!.curves)).toEqual([
      [original.curves![0], original.curves![3]],
      [original.curves![1], original.curves![4]],
      [original.curves![2]],
    ]);
    expect(pieces[0]!.paths[0]!.curves![0]!.segments.every((s) => s.kind === 'cubic')).toBe(true);
    expect(pieces.map((piece) => piece.paths[0]!.polylines)).toEqual([
      [original.polylines[0], original.polylines[3]],
      [original.polylines[1], original.polylines[4]],
      [original.polylines[2]],
    ]);
    for (const piece of pieces) {
      expect(piece.kind).toBe('traced-image');
      expect(piece.transform).toEqual(trace.transform);
      expect(piece.traceMode).toBe('filled-contours');
      expect(piece.tracePixelWidth).toBe(trace.tracePixelWidth);
      expect(piece.traceSourceId).toBeUndefined();
    }
    expect(pieces[2]!.bounds).toEqual({ minX: 88, minY: 8, maxX: 91, maxY: 11 });
    // The source image stays; the pieces select as the new selection.
    expect(useStore.getState().project.scene.objects[0]?.id).toBe('source');
    expect(useStore.getState().selectedObjectId).toBe('trace__part_1');
    expect([...useStore.getState().additionalSelectedIds]).toEqual([
      'trace__part_2',
      'trace__part_3',
    ]);
  });

  it('gives identical even-odd burn coverage and identical compiled line moves', () => {
    const trace = ringsAndSpeck();
    loadScene([trace]);
    const before = useStore.getState().project;
    select(trace.id);
    useStore.getState().breakApartSelection();
    const pieces = tracePieces();

    const originalLoops = trace.paths[0]!.polylines;
    let covered = 0;
    for (let y = 0.25; y < 60; y += 0.5) {
      for (let x = 0.25; x < 100; x += 0.5) {
        const point = { x, y };
        const inOriginal = evenOddCovers(originalLoops, point);
        const coveringPieces = pieces.filter((piece) =>
          evenOddCovers(piece.paths[0]!.polylines, point),
        ).length;
        expect(coveringPieces).toBe(inOriginal ? 1 : 0);
        if (inOriginal) covered += 1;
      }
    }
    expect(covered).toBeGreaterThan(1000);

    const after = useStore.getState().project;
    expect(compiledMoves(after.scene, after.device)).toEqual(
      compiledMoves(before.scene, before.device),
    );
  });

  it('keeps operation bindings, output settings and z-order, and one undo restores the trace', () => {
    const trace: TracedImage = {
      ...ringsAndSpeck(),
      operationIds: ['engrave'],
      powerScale: 70,
      operationOverride: { power: 42 },
    };
    const below = speckObject('below', 0);
    const above = speckObject('above', 50);
    loadScene([below, trace, above], ['above', 'trace', 'below']);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, groups: [{ id: 'g', name: 'G', objectIds: ['trace'] }] },
      },
    }));
    const before = useStore.getState().project;
    select(trace.id);

    useStore.getState().breakApartSelection();

    const scene = useStore.getState().project.scene;
    const pieceIds = ['trace__part_1', 'trace__part_2', 'trace__part_3'];
    expect(scene.objects.map((object) => object.id)).toEqual(['below', ...pieceIds, 'above']);
    expect(scene.artworkOrder).toEqual(['above', ...pieceIds, 'below']);
    expect(scene.groups?.[0]?.objectIds).toEqual(pieceIds);
    for (const piece of tracePieces()) {
      expect(operationIdsForObject(piece, scene.layers)).toEqual(['engrave']);
      expect(piece.powerScale).toBe(70);
      expect(piece.operationOverride).toEqual({ power: 42 });
    }
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();

    expect(useStore.getState().project).toBe(before);
  });

  it('refuses a locked trace', () => {
    const trace: TracedImage = { ...ringsAndSpeck(), locked: true };
    loadScene([trace]);
    select(trace.id);
    const before = useStore.getState().project;

    expect(selectionCanBreakApart(before, [trace.id])).toBe(false);
    useStore.getState().breakApartSelection();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('leaves a single ring with its hole whole and says why', () => {
    const ring = ringsAndSpeck();
    const path = ring.paths[0]!;
    const trace: TracedImage = {
      ...ring,
      paths: [
        {
          ...path,
          curves: [path.curves![0]!, path.curves![3]!],
          polylines: [path.polylines[0]!, path.polylines[3]!],
        },
      ],
    };
    loadScene([trace]);
    select(trace.id);
    const before = useStore.getState().project;
    const toasts = useToastStore.getState().toasts.length;

    useStore.getState().breakApartSelection();

    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.length).toBe(toasts + 1);
  });

  it('splits a centerline trace one stroke per piece, never treating a stroke as a hole', () => {
    const trace: TracedImage = { ...ringsAndSpeck(), traceMode: 'centerline' };
    loadScene([trace]);
    select(trace.id);

    useStore.getState().breakApartSelection();

    expect(tracePieces().map((piece) => piece.paths[0]!.curves!.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('splits an Edge trace by outer shape: its closed ink bands keep their holes', () => {
    // Edge Detection output is filled closed contours (edge-trace.ts), not strokes.
    const trace: TracedImage = { ...ringsAndSpeck(), traceMode: 'edge' };
    loadScene([trace]);
    select(trace.id);

    useStore.getState().breakApartSelection();

    const original = trace.paths[0]!;
    expect(tracePieces().map((piece) => piece.paths[0]!.curves)).toEqual([
      [original.curves![0], original.curves![3]],
      [original.curves![1], original.curves![4]],
      [original.curves![2]],
    ]);
    expect(tracePieces().every((piece) => piece.traceMode === 'edge')).toBe(true);
  });

  it('leaves an Edge trace of one ring whole', () => {
    const ring = ringsAndSpeck();
    const path = ring.paths[0]!;
    const trace: TracedImage = {
      ...ring,
      traceMode: 'edge',
      paths: [
        {
          ...path,
          curves: [path.curves![0]!, path.curves![3]!],
          polylines: [path.polylines[0]!, path.polylines[3]!],
        },
      ],
    };
    loadScene([trace]);
    select(trace.id);
    const before = useStore.getState().project;

    useStore.getState().breakApartSelection();

    expect(useStore.getState().project).toBe(before);
  });

  it('does no per-object scene-wide work for selected objects it cannot split', () => {
    // Break Apart can create thousands of pieces; Select All + Break Apart
    // again must not rebuild the scene's id set once per selected object.
    const selectedSpecks = Array.from({ length: 300 }, (_, index) =>
      speckObject(`speck-${index}`, index * 3),
    );
    let idReads = 0;
    const watched = speckObject('watched', 0);
    const counting = Object.defineProperty({ ...watched }, 'id', {
      enumerable: true,
      get: () => {
        idReads += 1;
        return watched.id;
      },
    }) as TracedImage;
    const trace = ringsAndSpeck();
    loadScene([counting, ...selectedSpecks, trace]);
    useStore.setState({
      selectedObjectId: trace.id,
      additionalSelectedIds: new Set(selectedSpecks.map((item) => item.id)),
    });
    idReads = 0;

    useStore.getState().breakApartSelection();

    expect(tracePieces()).toHaveLength(3);
    // A constant number of passes over the scene, not one per selected object.
    expect(idReads).toBeLessThan(40);
  });
});

function tracePieces(): ReadonlyArray<TracedImage> {
  return useStore
    .getState()
    .project.scene.objects.filter(
      (object): object is TracedImage =>
        object.kind === 'traced-image' && object.id.startsWith('trace__part_'),
    );
}

function select(id: string): void {
  useStore.setState({ selectedObjectId: id, additionalSelectedIds: new Set(), dirty: false });
}

function loadScene(
  objects: ReadonlyArray<SceneObject>,
  artworkOrder?: ReadonlyArray<string>,
): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [
          createLayer({ id: '#000000', color: '#000000' }),
          createLayer({ id: 'engrave', color: '#ff0000', name: 'Engrave' }),
        ],
        groups: [],
        ...(artworkOrder === undefined ? {} : { artworkOrder }),
      },
    },
    undoStack: [],
    redoStack: [],
  });
}

function evenOddCovers(loops: ReadonlyArray<Polyline>, point: Vec2): boolean {
  return loops.filter((loop) => pointInPolygon(point, loop.points)).length % 2 === 1;
}

function compiledMoves(...args: Parameters<typeof compileJob>): ReadonlyArray<string> {
  return compileJob(...args)
    .groups.flatMap((group) => (group.kind === 'cut' ? group.segments : []))
    .map((segment) => JSON.stringify(segment))
    .sort();
}

// Two rings (outer circle + reversed inner circle) and a speck, in a
// 100 x 60 px trace grid. Holes are listed after every outer so grouping must
// come from containment, not from order.
function ringsAndSpeck(): TracedImage {
  const curves = [
    circle(25, 30, 15, false),
    circle(65, 30, 15, false),
    speck(88, 8, 3),
    circle(25, 30, 7, true),
    circle(65, 30, 7, true),
  ];
  const path: ColoredPath = {
    color: '#000000',
    curves,
    polylines: curves.map(curvePoints),
  };
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'owl.png',
    traceSourceId: 'source',
    traceMode: 'filled-contours',
    tracePixelWidth: 100,
    tracePixelHeight: 60,
    bounds: { minX: 10, minY: 8, maxX: 91, maxY: 45 },
    transform: TRACE_TRANSFORM,
    paths: [path],
  };
}

function speckObject(id: string, x: number): TracedImage {
  const curve = speck(x, 0, 2);
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    bounds: { minX: x, minY: 0, maxX: x + 2, maxY: 2 },
    transform: TRACE_TRANSFORM,
    paths: [{ color: '#000000', curves: [curve], polylines: [curvePoints(curve)] }],
  };
}

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source',
    source: 'owl.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 100,
    pixelHeight: 60,
    bounds: { minX: 0, minY: 0, maxX: 25, maxY: 18 },
    transform: TRACE_TRANSFORM,
    color: '#000000',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function speck(x: number, y: number, size: number): CurveSubpath {
  return {
    start: { x, y },
    closed: true,
    segments: [
      { kind: 'line', to: { x: x + size, y } },
      { kind: 'line', to: { x: x + size, y: y + size } },
      { kind: 'line', to: { x, y: y + size } },
      { kind: 'line', to: { x, y } },
    ],
  };
}

function circle(cx: number, cy: number, r: number, reversed: boolean): CurveSubpath {
  const k = 0.5523 * r;
  const s = reversed ? -1 : 1;
  const p = (dx: number, dy: number): Vec2 => ({ x: cx + dx, y: cy + s * dy });
  return {
    start: p(r, 0),
    closed: true,
    segments: [
      { kind: 'cubic', control1: p(r, k), control2: p(k, r), to: p(0, r) },
      { kind: 'cubic', control1: p(-k, r), control2: p(-r, k), to: p(-r, 0) },
      { kind: 'cubic', control1: p(-r, -k), control2: p(-k, -r), to: p(0, -r) },
      { kind: 'cubic', control1: p(k, -r), control2: p(r, -k), to: p(r, 0) },
    ],
  };
}

// Compatibility view: the segment end points plus cubic midpoints, which is
// enough for the fixture's even-odd sampling.
function curvePoints(curve: CurveSubpath): Polyline {
  const points: Vec2[] = [curve.start];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      for (const t of [0.25, 0.5, 0.75]) points.push(cubicAt(from, segment, t));
    }
    points.push(segment.to);
    from = segment.to;
  }
  return { closed: curve.closed, points };
}

function cubicAt(
  from: Vec2,
  segment: Extract<CurveSubpath['segments'][number], { kind: 'cubic' }>,
  t: number,
): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}
