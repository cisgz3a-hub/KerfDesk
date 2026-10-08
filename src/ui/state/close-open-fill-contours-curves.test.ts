import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import type { FillSegment } from '../../core/job/job';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  createLayer,
  createProject,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type Project,
  type ShapeObject,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseSvg } from '../../io/svg/parse-svg';
import { selectedOpenFillContourCount } from '../common/fill-diagnostics';
import type { CloseOpenFillContoursActions } from './close-open-fill-contours-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 100,
  bedHeight: 100,
};
const fill = {
  ...createLayer({ id: 'fill', name: 'Fill', color: '#000000', mode: 'fill' }),
  hatchSpacingMm: 1,
  hatchAngleDeg: 0,
};
const nearCurve = 'M10 10 C20 10 20 20 10 20 L10.25 10.25';
const farCurve = 'M50 10 C60 10 60 20 50 20 L52 10';
const closedControl = 'M30 30 H38 V38 H30 Z';

beforeEach(() => resetStore());

describe('close open Fill contours with canonical SVG curves', () => {
  it('adds executable Fill for a parsed cubic and preserves the closed control', () => {
    const curved = parsedArtwork('curved', nearCurve);
    const control = parsedArtwork('control', closedControl);
    const before = load(curved, control);
    const original = canonicalContour(curved);
    expect(original.curve.segments[0]?.kind).toBe('cubic');
    expect(original.curve.closed).toBe(false);
    const baseline = fillSegments(before);
    expect(baseline).toHaveLength(fillSegments(project([control])).length);
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline.every((segment) => segment.polyline.every((point) => point.y >= 30))).toBe(
      true,
    );
    expect(openCount()).toBe(1);

    useStore.getState().closeSelectedOpenFillContours();

    const after = useStore.getState().project;
    expect(fillSegments(after).length).toBeGreaterThan(baseline.length);
    expect(
      fillSegments(after).some((segment) => segment.polyline.every((point) => point.y < 30)),
    ).toBe(true);
    const repaired = canonicalContour(artwork(after, curved.id));
    expect(repaired.curve.closed).toBe(true);
    expect(repaired.polyline.closed).toBe(true);
    expect(compilationPolylines(repaired.path, curved.transform)[0]?.closed).toBe(true);
    expect(artwork(after, control.id)).toEqual(control);
    expect(openCount()).toBe(0);
  });

  it('restores the original curve and compiled output with Undo and restores the repair with Redo', () => {
    const curved = parsedArtwork('curved', nearCurve);
    const before = load(curved, parsedArtwork('control', closedControl));
    const baseline = compileJob(before.scene, before.device);

    useStore.getState().closeSelectedOpenFillContours();

    const repaired = useStore.getState().project;
    const repairedJob = compileJob(repaired.scene, repaired.device);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().redoStack).toHaveLength(0);

    useStore.getState().undo();

    expect(useStore.getState().project).toEqual(before);
    expect(artwork(useStore.getState().project, curved.id)).toEqual(curved);
    expect(compileJob(useStore.getState().project.scene, before.device)).toEqual(baseline);
    expect(openCount()).toBe(1);

    useStore.getState().redo();

    expect(useStore.getState().project).toEqual(repaired);
    expect(compileJob(useStore.getState().project.scene, before.device)).toEqual(repairedJob);
    expect(fillSegments(repaired).length).toBeGreaterThan(fillSegments(before).length);
  });

  it('saves and reopens the repaired canonical closure with identical compiled Fill', () => {
    const curved = parsedArtwork('curved', nearCurve);
    const before = load(curved, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    const repaired = useStore.getState().project;
    const reopened = deserializeProject(serializeProject(repaired));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error('Expected the repaired project to reopen');
    expect(compileJob(reopened.project.scene, reopened.project.device)).toEqual(
      compileJob(repaired.scene, repaired.device),
    );
    expect(artwork(reopened.project, curved.id).paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(fillSegments(reopened.project).length).toBeGreaterThan(fillSegments(before).length);
  });

  it('repairs only the eligible subpath when another contour in the same path exceeds tolerance', () => {
    const curved = parsedArtwork('curved', nearCurve + ' ' + farCurve);
    expect(curved.paths).toHaveLength(1);
    expect(curved.paths[0]?.curves).toHaveLength(2);
    const before = load(curved, parsedArtwork('control', closedControl));
    expect(openCount()).toBe(2);

    useStore.getState().closeSelectedOpenFillContours();

    const after = useStore.getState().project;
    const curves = artwork(after, curved.id).paths[0]?.curves;
    expect(curves?.[0]?.closed).toBe(true);
    expect(curves?.[1]).toEqual(curved.paths[0]?.curves?.[1]);
    expect(curves?.[1]?.closed).toBe(false);
    expect(openCount()).toBe(1);
    expect(fillSegments(after).length).toBeGreaterThan(fillSegments(before).length);
  });

  it('leaves an oversized canonical gap unresolved without adding an undo entry', () => {
    const curved = parsedArtwork('curved', farCurve);
    const before = load(curved, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(artwork(useStore.getState().project, curved.id)).toEqual(curved);
    expect(openCount()).toBe(1);
    expect(fillSegments(useStore.getState().project)).toEqual(fillSegments(before));
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('closes an oversized canonical gap only within the explicitly reviewed tolerance', () => {
    const curved = parsedArtwork('curved', farCurve);
    const before = load(curved, parsedArtwork('control', closedControl));

    const actions = useStore.getState() as ReturnType<typeof useStore.getState> &
      CloseOpenFillContoursActions;
    actions.closeSelectedOpenFillContoursWithTolerance(3);

    const after = useStore.getState().project;
    expect(artwork(after, curved.id).paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(openCount()).toBe(0);
    expect(fillSegments(after).length).toBeGreaterThan(fillSegments(before).length);
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('does not claim a repair when curves and compatibility polylines cannot be paired', () => {
    const source = parsedArtwork('curved', nearCurve);
    const path = source.paths[0];
    if (path === undefined || path.polylines[0] === undefined) {
      throw new Error('Expected the parsed compatibility polyline');
    }
    const mismatched: ImportedSvg = {
      ...source,
      paths: [{ ...path, polylines: [...path.polylines, path.polylines[0]] }],
    };
    const before = load(mismatched, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(artwork(useStore.getState().project, source.id).paths[0]?.curves?.[0]?.closed).toBe(
      false,
    );
    expect(openCount()).toBeGreaterThan(0);
    expect(fillSegments(useStore.getState().project)).toEqual(fillSegments(before));
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('repairs a legacy flag-only closed compatibility contour without discarding its last endpoint', () => {
    const source = parsedArtwork('curved', nearCurve);
    const original = canonicalContour(source);
    const legacy: ImportedSvg = {
      ...source,
      paths: [{ ...original.path, polylines: [{ ...original.polyline, closed: true }] }],
    };
    const before = load(legacy, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    const after = useStore.getState().project;
    const repaired = canonicalContour(artwork(after, legacy.id));
    expect(repaired.curve.closed).toBe(true);
    expect(repaired.curve.segments.slice(0, -1)).toEqual(original.curve.segments);
    expect(repaired.polyline.points).toEqual([
      ...original.polyline.points,
      original.polyline.points[0],
    ]);
    expect(fillSegments(after).length).toBeGreaterThan(fillSegments(before).length);
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('synchronizes a drawn polyline shape specification, curves and seam through save/reopen', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10.25, y: 10.25 },
    ];
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: { closed: false, points },
    });
    const materialized = canonicalContour(shape).polyline.points;
    expect(materialized.length).toBeGreaterThan(points.length);
    const annotated: ShapeObject = {
      ...shape,
      laserTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.4 }],
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.6 }],
    };
    const before = load(annotated, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    const after = useStore.getState().project;
    const repaired = drawnShape(after, annotated.id);
    expect(repaired.spec).toEqual({ kind: 'polyline', closed: true, points: materialized });
    expect(repaired.paths[0]?.polylines[0]?.points).toEqual([...materialized, materialized[0]]);
    expect(repaired.paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(repaired.laserTabAnchors).toEqual(annotated.laserTabAnchors);
    expect(repaired.cncTabAnchors).toEqual(annotated.cncTabAnchors);
    expect(fillSegments(after).length).toBeGreaterThan(fillSegments(before).length);
    const reopened = deserializeProject(serializeProject(after));
    if (reopened.kind !== 'ok') throw new Error('Expected the repaired shape to reopen');
    expect(drawnShape(reopened.project, annotated.id).spec).toEqual(repaired.spec);
    expect(compileJob(reopened.project.scene, reopened.project.device)).toEqual(
      compileJob(after.scene, after.device),
    );
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('leaves an ambiguous polyline shape representation unchanged', () => {
    const shape = createPolyline({
      id: 'pen',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10.25, y: 10.25 },
        ],
      },
    });
    const path = shape.paths[0];
    if (path === undefined) throw new Error('Expected the drawn shape path');
    const ambiguous: ShapeObject = {
      ...shape,
      paths: [path, path],
    };
    const before = load(ambiguous, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it.each([0.1, 2])('measures the canonical gap after an object scale of %s', (scale) => {
    const source = parsedArtwork('curved', nearCurve);
    const scaled = {
      ...source,
      transform: { ...source.transform, scaleX: scale, scaleY: scale },
    };
    const before = load(scaled, parsedArtwork('control', closedControl));

    useStore.getState().closeSelectedOpenFillContours();

    if (scale < 1) {
      expect(canonicalContour(artwork(useStore.getState().project, scaled.id)).curve.closed).toBe(
        true,
      );
    } else {
      expect(useStore.getState().project).toBe(before);
      expect(canonicalContour(artwork(before, scaled.id)).curve.closed).toBe(false);
      const actions = useStore.getState() as ReturnType<typeof useStore.getState> &
        CloseOpenFillContoursActions;
      actions.closeSelectedOpenFillContoursWithTolerance(1);
      expect(canonicalContour(artwork(useStore.getState().project, scaled.id)).curve.closed).toBe(
        true,
      );
    }
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('keeps general Close Path able to close a larger gap and add its Fill', () => {
    const curved = parsedArtwork('curved', farCurve);
    const control = parsedArtwork('control', closedControl);
    const before = load(curved, control);

    useStore.getState().closeSelectedPaths();

    const after = useStore.getState().project;
    expect(artwork(after, curved.id).paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(artwork(after, control.id)).toEqual(control);
    expect(fillSegments(after).length).toBeGreaterThan(fillSegments(before).length);
    expect(openCount()).toBe(0);
    expect(useStore.getState().undoStack).toEqual([before]);
  });
});

function parsedArtwork(id: string, pathData: string): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: id + '.svg',
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      '<path fill="none" stroke="#000000" d="' +
      pathData +
      '"/></svg>',
  });
  if (parsed.object === null) throw new Error('Expected parsed SVG artwork');
  return {
    ...parsed.object,
    paths: parsed.object.paths.map((path) => ({ ...path, operationIds: [fill.id] })),
  };
}

function project(objects: ReadonlyArray<ImportedSvg | ShapeObject>): Project {
  return {
    ...createProject(device),
    scene: { objects, layers: [fill], groups: [] },
  };
}

function load(curved: ImportedSvg | ShapeObject, control: ImportedSvg): Project {
  const initial = project([curved, control]);
  useStore.setState({
    project: initial,
    selectedObjectId: curved.id,
    additionalSelectedIds: new Set(),
    dirty: false,
    undoStack: [],
    redoStack: [],
  });
  return initial;
}

function artwork(project: Project, id: string): ImportedSvg {
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  if (object?.kind !== 'imported-svg') throw new Error('Expected parsed SVG ' + id);
  return object;
}

function drawnShape(project: Project, id: string): ShapeObject {
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  if (object?.kind !== 'shape') throw new Error('Expected drawn polyline ' + id);
  return object;
}

function fillSegments(project: Project): ReadonlyArray<FillSegment> {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'fill' ? group.segments : [],
  );
}

function openCount(): number {
  const state = useStore.getState();
  return selectedOpenFillContourCount(
    state.project,
    state.selectedObjectId,
    state.additionalSelectedIds,
  );
}

function canonicalContour(object: ImportedSvg | ShapeObject): {
  readonly path: ColoredPath;
  readonly curve: CurveSubpath;
  readonly polyline: Polyline;
} {
  const path = object.paths[0];
  const curve = path?.curves?.[0];
  const polyline = path?.polylines[0];
  if (path === undefined || curve === undefined || polyline === undefined) {
    throw new Error('Expected paired canonical and compatibility contour data');
  }
  return { path, curve, polyline };
}
