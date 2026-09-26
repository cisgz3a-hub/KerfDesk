import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../scene';
import { DEFAULT_LASER_KERF_MM, laserKerfFor } from './operation-targets';
import { checkProjectMinimumFeatures } from './project-check';

// A device without a laser head profile, so the kerf comes from the operation.
const { laserSubProfile: _head, ...HEADLESS_DEVICE } = DEFAULT_DEVICE_PROFILE;

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

/** Sheet with four 10 mm holes; neighbouring holes are `bridgeMm` apart. */
function stencilPolylines(bridgeMm: number): Polyline[] {
  const holes = [0, 1, 2, 3].map((i) => rectangle(5 + i * (10 + bridgeMm), 5, 10, 10));
  return [rectangle(0, 0, 70, 20), ...holes];
}

function artwork(id: string, operationId: string, polylines: ReadonlyArray<Polyline>): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [operationId],
    bounds: { minX: 0, minY: 0, maxX: 70, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', operationIds: [operationId], polylines }],
  };
}

function laserProject(layer: Partial<Layer>, polylines: ReadonlyArray<Polyline>): Project {
  const operation: Layer = {
    ...createLayer({ id: 'cut', color: '#000000' }),
    name: 'Cut',
    ...layer,
  };
  const device = HEADLESS_DEVICE;
  return {
    ...createProject(device),
    scene: { objects: [artwork('stencil', 'cut', polylines)], layers: [operation] },
  };
}

function cncProject(cutType: CncCutType, polylines: ReadonlyArray<Polyline>): Project {
  const layer: Layer = {
    ...createLayer({ id: 'cnc', color: '#000000' }),
    name: 'Router',
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, toolId: 'em-3000' },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [artwork('part', 'cnc', polylines)], layers: [layer] },
  };
}

describe('checkProjectMinimumFeatures', () => {
  it('checks a laser Line cut against twice its Kerf Offset', () => {
    const [report] = checkProjectMinimumFeatures(
      laserProject({ mode: 'line', kerfOffsetMm: 0.075 }, stencilPolylines(0.1)),
    );
    expect(report?.request.thresholdMm).toBeCloseTo(0.15, 12);
    expect(report?.widthSource).toBe('kerf-offset');
    expect(report?.analysis.widths.count).toBe(3);
    expect(report?.analysis.widths.minWidthMm).toBeCloseTo(0.1, 9);
    expect(report?.analysis.gaps.count).toBe(0);
  });

  it('reports nothing for 0.3 mm bridges at a 0.15 mm kerf', () => {
    const [report] = checkProjectMinimumFeatures(
      laserProject({ mode: 'line', kerfOffsetMm: 0.075 }, stencilPolylines(0.3)),
    );
    expect(report?.analysis.widths.count).toBe(0);
    expect(report?.analysis.gaps.count).toBe(0);
  });

  it('skips Fill and Image operations', () => {
    expect(
      checkProjectMinimumFeatures(laserProject({ mode: 'fill' }, stencilPolylines(0.1))),
    ).toEqual([]);
    expect(
      checkProjectMinimumFeatures(laserProject({ mode: 'image' }, stencilPolylines(0.1))),
    ).toEqual([]);
  });

  it('warns about a 2 mm slot pocketed with a 3 mm bit', () => {
    const [report] = checkProjectMinimumFeatures(cncProject('pocket', [rectangle(10, 10, 2, 20)]));
    expect(report?.request.thresholdMm).toBe(3);
    expect(report?.toolName).toBe('3 mm end mill');
    expect(report?.analysis.widths.count).toBe(1);
    expect(report?.analysis.widths.minWidthMm).toBeCloseTo(2, 9);
  });

  it('checks gaps, not widths, for an outside profile', () => {
    const parts = [rectangle(0, 0, 2, 20), rectangle(4, 0, 10, 20)];
    const [report] = checkProjectMinimumFeatures(cncProject('profile-outside', parts));
    expect(report?.analysis.widths.count).toBe(0);
    expect(report?.analysis.gaps.count).toBe(1);
    expect(report?.analysis.gaps.minWidthMm).toBeCloseTo(2, 9);
  });

  it('skips CNC engrave and V-carve operations', () => {
    const slot = [rectangle(10, 10, 2, 20)];
    expect(checkProjectMinimumFeatures(cncProject('engrave', slot))).toEqual([]);
    expect(checkProjectMinimumFeatures(cncProject('v-carve', slot))).toEqual([]);
  });

  it('limits a fresh-trace check to the named objects', () => {
    const project = laserProject({ mode: 'line', kerfOffsetMm: 0.075 }, stencilPolylines(0.1));
    expect(checkProjectMinimumFeatures(project, { objectIds: new Set(['other']) })).toEqual([]);
    expect(checkProjectMinimumFeatures(project, { objectIds: new Set(['stencil']) })).toHaveLength(
      1,
    );
  });

  it('checks only the edge of a traced double-line ring that the CNC profile machines', () => {
    // A drawn line traced as a ring: a 30 mm square outer edge and an inner
    // edge 1 mm in. Compile keeps one edge for a 3 mm bit (ADR-218), so there
    // is no 1 mm band to warn about.
    const ring = [rectangle(0, 0, 30, 30), rectangle(1, 1, 28, 28)];
    for (const cutType of ['profile-on-path', 'profile-inside'] as const) {
      const [report] = checkProjectMinimumFeatures(cncProject(cutType, ring));
      expect(report?.analysis.widths.count).toBe(0);
      expect(report?.analysis.gaps.count).toBe(0);
    }
    // Asked to machine both edges, the band is there and is reported.
    const both = cncProject('profile-inside', ring);
    const layers = both.scene.layers.map((layer) => ({
      ...layer,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...layer.cnc, lineArtContours: 'both' as const },
    }));
    const [report] = checkProjectMinimumFeatures({ ...both, scene: { ...both.scene, layers } });
    expect(report?.analysis.widths.count).toBe(1);
    expect(report?.analysis.widths.minWidthMm).toBeCloseTo(1, 9);
  });

  it('treats a plain Line operation as an assumed cut, and Kerf Offset, tabs or passes as declared', () => {
    const intent = (layer: Partial<Layer>): string | undefined =>
      checkProjectMinimumFeatures(
        laserProject({ mode: 'line', ...layer }, stencilPolylines(0.1)),
      )[0]?.cutIntent;
    expect(intent({})).toBe('assumed');
    expect(intent({ kerfOffsetMm: 0.075 })).toBe('declared');
    expect(intent({ tabsEnabled: true })).toBe('declared');
    expect(intent({ passes: 2 })).toBe('declared');
    const fresh = checkProjectMinimumFeatures(
      laserProject({ mode: 'line' }, stencilPolylines(0.1)),
      { objectIds: new Set(['stencil']), declaredCutsOnly: true },
    );
    expect(fresh).toEqual([]);
  });

  it('keeps objects cut at the same kerf from different sources apart', () => {
    const base = laserProject({ mode: 'line', kerfOffsetMm: 0.075 }, stencilPolylines(0.1));
    const [first] = base.scene.objects;
    if (first === undefined) throw new Error('fixture');
    const overridden: SceneObject = {
      ...artwork('copy', 'cut', stencilPolylines(0.1)),
      operationOverride: { kerfOffsetMm: 0, passes: 2 },
    };
    for (const objects of [
      [first, overridden],
      [overridden, first],
    ]) {
      const reports = checkProjectMinimumFeatures({ ...base, scene: { ...base.scene, objects } });
      expect(reports.map((report) => report.widthSource).sort()).toEqual([
        'default-kerf',
        'kerf-offset',
      ]);
      for (const report of reports) expect(report.request.thresholdMm).toBeCloseTo(0.15, 12);
    }
  });

  it('shares one budget across operations and marks the rest unchecked', () => {
    const project = laserProject({ mode: 'line', kerfOffsetMm: 0.075 }, stencilPolylines(0.1));
    const [report] = checkProjectMinimumFeatures(project, {
      budget: { maxPieces: 1_000_000, maxPairTests: 10 },
    });
    expect(report?.analysis.complete).toBe(false);
  });
});

describe('laserKerfFor', () => {
  const device = HEADLESS_DEVICE;

  it('prefers Kerf Offset, then the spot size, then the documented default', () => {
    expect(laserKerfFor({ kerfOffsetMm: -0.1 }, device)).toEqual({
      mm: 0.2,
      source: 'kerf-offset',
    });
    const headed = {
      ...DEFAULT_DEVICE_PROFILE,
      laserSubProfile: {
        model: 'test head',
        focusMode: 'manual' as const,
        airAssist: 'none' as const,
        spotSizeMm: { x: 0.16, y: 0.18 },
      },
    };
    expect(laserKerfFor({ kerfOffsetMm: 0 }, headed)).toEqual({ mm: 0.18, source: 'spot-size' });
    expect(laserKerfFor({ kerfOffsetMm: 0 }, device)).toEqual({
      mm: DEFAULT_LASER_KERF_MM,
      source: 'default-kerf',
    });
  });
});
