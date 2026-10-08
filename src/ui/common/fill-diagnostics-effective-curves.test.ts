import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type Layer,
  type LayerFillStyle,
  type Project,
  createProject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { parseSvg } from '../../io/svg/parse-svg';
import { partitionSavePreflight } from '../app/save-preflight-policy';
import { partitionEmitPreflight } from '../laser/start-job-readiness-policy';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  selectedCloseableOpenFillContourCount,
  selectedOpenFillContourCount,
  selectedOpenFillContourRepairSummary,
} from './fill-diagnostics';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 500,
  bedHeight: 500,
};
const operation = createLayer({ id: 'operation', color: '#000000', mode: 'line' });
const controlOperation = createLayer({ id: 'control', color: '#ff0000', mode: 'line' });
const fillStyles = ['scanline', 'island', 'offset'] as const;
const nearCurve = 'M10 10 C20 10 20 20 10 20 L10.25 10.25';
const controlData = 'M30 30 H38 V38 H30 Z';

beforeEach(() => resetStore());

describe('effective Fill diagnostics follow canonical output geometry', () => {
  it.each(fillStyles)(
    'finds and repairs a scoped %s Fill override on a base Line operation',
    (style) => {
      const curved = fillOverride(style);
      const before = load(curved);
      expect(openCount()).toBe(1);
      expect(closeableCount()).toBe(1);
      expect(fillCount(before)).toBe(0);

      useStore.getState().closeSelectedOpenFillContours();

      const after = useStore.getState().project;
      expect(artwork(after).paths[0]?.curves?.[0]?.closed).toBe(true);
      expect(openCount()).toBe(0);
      expect(fillCount(after)).toBeGreaterThan(0);
    },
  );

  it.each(fillStyles)(
    'discloses unselected open %s Fill as an advisory on Start and Save',
    (style) => {
      const initial = load(fillOverride(style));
      useStore.setState({ selectedObjectId: null });
      expect(openCount()).toBe(0);

      const emitted = emitGcode(initial);
      const openIssues = emitted.preflight.issues.filter((issue) =>
        issue.code.includes('open-contour'),
      );
      expect(emitted.gcode).toMatch(/^G1 /m);
      expect(openIssues).toHaveLength(1);
      expect.soft(openIssues[0]?.message).not.toMatch(/or use Scanline Fill/i);
      const start = partitionEmitPreflight(emitted.preflight);
      const save = partitionSavePreflight(emitted.preflight.issues);
      expect(start.blocking).toHaveLength(0);
      expect(save.blocking).toHaveLength(0);
      expect(start.warnings).toContain(openIssues[0]?.message);
      expect(save.advisories).toContainEqual(openIssues[0]);
    },
  );

  it('recognises a legacy global Fill override as the effective operation', () => {
    const curved: ImportedSvg = {
      ...parsedArtwork(),
      operationOverride: { mode: 'fill', fillStyle: 'scanline' },
    };
    load(curved);

    expect(openCount()).toBe(1);
    expect(closeableCount()).toBe(1);
  });

  it('includes an enabled Fill suboperation inherited from a base Line binding', () => {
    const fillPass = createLayerSubLayer(operation, {
      id: 'fill-pass',
      label: 'Fill pass',
      settings: captureLayerOperationSettings(fillLayer('scanline')),
    });
    const layered = { ...operation, subLayers: [fillPass] };
    const before = load(parsedArtwork(), [layered]);

    expect(openCount()).toBe(1);
    expect(closeableCount()).toBe(1);
    expect(openIssueCount(before)).toBe(1);

    useStore.getState().closeSelectedOpenFillContours();

    expect(fillCount(useStore.getState().project)).toBeGreaterThan(0);
    expect(openCount()).toBe(0);
  });

  it('ignores disabled Fill suboperations and an output-off parent with a Fill override', () => {
    const disabledFill = createLayerSubLayer(operation, {
      id: 'disabled-fill',
      label: 'Disabled fill',
      enabled: false,
      settings: captureLayerOperationSettings(fillLayer('scanline')),
    });
    const offParent = {
      ...fillLayer('offset'),
      id: 'off',
      output: false,
      subLayers: [
        createLayerSubLayer(operation, {
          id: 'off-child',
          label: 'Disabled with parent',
          settings: captureLayerOperationSettings(fillLayer('island')),
        }),
      ],
    };
    const curved: ImportedSvg = {
      ...parsedArtwork(nearCurve, ['operation', 'off']),
      operationOverride: { byOperation: { off: { mode: 'fill', fillStyle: 'scanline' } } },
    };
    const before = load(curved, [{ ...operation, subLayers: [disabledFill] }, offParent]);

    expect(openCount()).toBe(0);
    expect(closeableCount()).toBe(0);
    expect(openIssueCount(before)).toBe(0);

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('does not warn or repair a base Fill contour effectively overridden to Line', () => {
    const curved: ImportedSvg = {
      ...parsedArtwork(),
      operationOverride: { byOperation: { operation: { mode: 'line' } } },
    };
    const before = load(curved, [fillLayer('offset')]);

    expect.soft(openCount()).toBe(0);
    expect.soft(closeableCount()).toBe(0);
    expect.soft(openIssueCount(before)).toBe(0);

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('repairs legacy compatibility flags from canonical endpoints without dropping the old endpoint', () => {
    const source = parsedArtwork();
    const curved: ImportedSvg = {
      ...source,
      paths: source.paths.map((path) => ({
        ...path,
        polylines: path.polylines.map((polyline) => ({ ...polyline, closed: true })),
      })),
    };
    const before = load(curved, [fillLayer('scanline')]);
    const original = canonicalContour(curved);
    expect(fillCount(before)).toBe(0);
    expect.soft(openCount()).toBe(1);
    expect.soft(closeableCount()).toBe(1);
    expect.soft(openIssueCount(before)).toBe(1);

    useStore.getState().closeSelectedOpenFillContours();

    const repaired = canonicalContour(artwork(useStore.getState().project));
    expect(repaired.curve.closed).toBe(true);
    expect(repaired.polyline.points.slice(0, -1)).toEqual(original.polyline.points);
    expect(repaired.polyline.points.at(-1)).toEqual(original.polyline.points[0]);
    expect(repaired.curve.segments.slice(0, original.curve.segments.length)).toEqual(
      original.curve.segments,
    );
    expect(fillCount(useStore.getState().project)).toBeGreaterThan(0);
    expect(openCount()).toBe(0);
  });

  it('keeps mismatched representations visible but ineligible for repair', () => {
    const source = parsedArtwork();
    const path = source.paths[0];
    if (path?.polylines[0] === undefined) throw new Error('Expected parsed compatibility data');
    const curved: ImportedSvg = {
      ...source,
      paths: [{ ...path, polylines: [...path.polylines, path.polylines[0]] }],
    };
    const before = load(curved, [fillLayer('scanline')]);
    expect.soft(openCount()).toBe(1);
    expect.soft(closeableCount()).toBe(0);

    useStore.getState().closeSelectedOpenFillContours();

    expect(useStore.getState().project).toBe(before);
    expect(openCount()).toBe(1);
    expect(openIssueCount(before)).toBe(1);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it.each([
    { scale: 10, open: 1, fills: false },
    { scale: 0.1, open: 0, fills: true },
  ])('uses canonical world-space closure at scale $scale', ({ scale, open, fills }) => {
    const parsed = parsedArtwork();
    const end = { x: 10.00005, y: 10 };
    // Model an omitted close flag after editing/reopening. The SVG parser
    // promotes nearly coincident endpoints to closed during a fresh import.
    const source: ImportedSvg = {
      ...parsed,
      paths: parsed.paths.map((path) => ({
        ...path,
        ...(path.curves === undefined
          ? {}
          : {
              curves: path.curves.map((curve) => ({
                ...curve,
                closed: false,
                segments: [...curve.segments.slice(0, -1), { kind: 'line' as const, to: end }],
              })),
            }),
        polylines: path.polylines.map((polyline) => ({
          ...polyline,
          closed: false,
          points: [...polyline.points.slice(0, -1), end],
        })),
      })),
    };
    const curved: ImportedSvg = {
      ...source,
      transform: { ...source.transform, scaleX: scale, scaleY: scale },
    };
    const initial = load(curved, [fillLayer('scanline')]);

    expect(artwork(initial).paths[0]?.curves?.[0]?.closed).toBe(false);
    expect(fillCount(initial) > 0).toBe(fills);
    expect(openCount()).toBe(open);
    expect(openIssueCount(initial)).toBe(open);
  });

  it('measures canonical repair tolerance after object scaling', () => {
    const largeSource = parsedArtwork();
    const large: ImportedSvg = {
      ...largeSource,
      transform: { ...largeSource.transform, scaleX: 2, scaleY: 2 },
    };
    const largeProject = load(large, [fillLayer('scanline')]);
    expect(openCount()).toBe(1);
    expect(closeableCount()).toBe(0);
    useStore.getState().closeSelectedOpenFillContours();
    expect(useStore.getState().project).toBe(largeProject);

    const smallSource = parsedArtwork('M10 10 C20 10 20 20 10 20 L12 10');
    const small: ImportedSvg = {
      ...smallSource,
      transform: { ...smallSource.transform, scaleX: 0.1, scaleY: 0.1 },
    };
    load(small, [fillLayer('scanline')]);
    expect(closeableCount()).toBe(1);
    useStore.getState().closeSelectedOpenFillContours();
    expect(artwork(useStore.getState().project).paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(openCount()).toBe(0);
    expect(fillCount(useStore.getState().project)).toBeGreaterThan(0);
  });

  it('counts one physical contour once across multiple output Fill operations', () => {
    const base = fillLayer('scanline');
    const alsoFill = { ...fillLayer('island'), id: 'also-fill' };
    const sub = createLayerSubLayer(base, {
      id: 'another-fill',
      label: 'Another fill pass',
      settings: captureLayerOperationSettings(fillLayer('offset')),
    });
    const curved = parsedArtwork(nearCurve, ['operation', 'also-fill']);
    load(curved, [{ ...base, subLayers: [sub] }, alsoFill]);

    expect(openCount()).toBe(1);
    expect(closeableCount()).toBe(1);
    expect(
      selectedOpenFillContourRepairSummary(useStore.getState().project, curved.id, new Set(), 0.5),
    ).toEqual({ openCount: 1, safeCount: 1, reviewedCount: 0, remainingCount: 0 });
  });
});

function fillLayer(style: LayerFillStyle): Layer {
  return {
    ...operation,
    mode: 'fill',
    fillStyle: style,
    hatchAngleDeg: 0,
    hatchSpacingMm: 0.25,
  };
}

function fillOverride(style: LayerFillStyle): ImportedSvg {
  return {
    ...parsedArtwork(),
    operationOverride: {
      byOperation: { operation: { mode: 'fill', fillStyle: style, hatchSpacingMm: 0.25 } },
    },
  };
}

function parsedArtwork(
  data = nearCurve,
  operationIds: ReadonlyArray<string> = [operation.id],
  id = 'curved',
  color = '#000000',
): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: id + '.svg',
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">' +
      '<path fill="none" stroke="' +
      color +
      '" d="' +
      data +
      '"/></svg>',
  });
  if (parsed.object === null) throw new Error('Expected parsed SVG');
  return {
    ...parsed.object,
    paths: parsed.object.paths.map((path) => ({ ...path, operationIds })),
  };
}

function load(curved: ImportedSvg, layers: ReadonlyArray<Layer> = [operation]): Project {
  const control = parsedArtwork(controlData, [controlOperation.id], 'control', '#ff0000');
  const initial = {
    ...createProject(device),
    scene: { objects: [curved, control], layers: [...layers, controlOperation], groups: [] },
  };
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

function artwork(project: Project): ImportedSvg {
  const object = project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('Expected imported cubic');
  return object;
}

function fillCount(project: Project): number {
  return compileJob(project.scene, project.device).groups.reduce(
    (total, group) => total + (group.kind === 'fill' ? group.segments.length : 0),
    0,
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

function closeableCount(): number {
  const state = useStore.getState();
  return selectedCloseableOpenFillContourCount(
    state.project,
    state.selectedObjectId,
    state.additionalSelectedIds,
  );
}

function openIssueCount(project: Project): number {
  return emitGcode(project).preflight.issues.filter((issue) => issue.code.includes('open-contour'))
    .length;
}

function canonicalContour(object: ImportedSvg): {
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
