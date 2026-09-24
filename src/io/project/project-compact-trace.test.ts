import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { compileJob } from '../../core/job';
import { boundsFromColoredPaths, coloredPathsToSvg } from '../../core/trace';
import { emitGcode } from '../gcode/emit-gcode';
import { exportSceneSvg } from '../svg/export-scene-svg';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { prepareProjectForAutosave } from './prepare-project-autosave';
import { assembleBitmap } from '../../ui/raster/bitmap-assembly';
import { lumaToBase64 } from '../../ui/raster/luma-bitmap';

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

const lines = [rectangle(0, 0, 8, 8), rectangle(1, 2, 3, 2), rectangle(9, 0, 0.017, 8)];
const exact: ColoredPath = {
  color: '#000000',
  fillRule: 'evenodd',
  operationIds: ['photo-fill'],
  polylines: lines,
  curves: lines.map(polylineToCurveSubpath),
};

function withoutCurves(path: ColoredPath): ColoredPath {
  const { curves: _curves, ...rest } = path;
  return rest;
}

function projectFor(paths: readonly ColoredPath[]): Project {
  const base = createProject();
  const object: TracedImage = {
    kind: 'traced-image',
    id: 'photo',
    source: 'photo.png',
    traceMode: 'filled-contours',
    bounds: boundsFromColoredPaths(paths),
    transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
    paths,
  };
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [object],
      layers: [
        createLayer({ id: 'photo-fill', color: '#000000', mode: 'fill', hatchSpacingMm: 0.2 }),
      ],
    },
  };
}

function firstPath(project: Project): ColoredPath {
  const object = project.scene.objects[0];
  if (object === undefined || !('paths' in object) || object.paths[0] === undefined) {
    throw new Error('Expected traced geometry');
  }
  return object.paths[0];
}

function read(json: string): Project {
  const result = deserializeProject(json);
  if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
  return result.project;
}

describe('compact traced-image persistence and output', () => {
  it.each([false, true])(
    'saves exact redundant lines once, compact=%s, without changing live geometry',
    (compact) => {
      const project = projectFor([exact]);
      const originalCurves = firstPath(project).curves;
      const saved = serializeProject(project, { compact });
      expect(firstPath(project).curves).toBe(originalCurves);
      const restored = read(saved);
      expect(firstPath(restored).polylines).toEqual(exact.polylines);
      expect(firstPath(restored).curves).toBeUndefined();
    },
  );

  it('does not regenerate missing line curves in manual or autosave preparation', () => {
    const project = projectFor([withoutCurves(exact)]);
    const manual = prepareProjectForPersistence(project);
    const autosave = prepareProjectForAutosave(project);
    expect(manual.kind).toBe('ok');
    expect(autosave.kind).toBe('ok');
    if (manual.kind !== 'ok' || autosave.kind !== 'ok') throw new Error('Save failed');
    expect(firstPath(read(manual.json)).curves).toBeUndefined();
    expect(firstPath(read(autosave.json)).curves).toBeUndefined();
  });

  it.each(['coordinate', 'closure', 'count', 'order', 'empty-polyline', 'cubic', 'arc'] as const)(
    'retains canonical authority when %s prevents exact redundancy',
    (difference) => {
      const curve = exact.curves![0]!;
      let path: ColoredPath = { ...exact };
      if (difference === 'coordinate')
        path = { ...path, polylines: [rectangle(0, 0, 7, 8), ...lines.slice(1)] };
      if (difference === 'closure')
        path = { ...path, polylines: [{ ...lines[0]!, closed: false }, ...lines.slice(1)] };
      if (difference === 'count') path = { ...path, polylines: lines.slice(1) };
      if (difference === 'order') path = { ...path, polylines: [...lines].reverse() };
      if (difference === 'empty-polyline')
        path = { ...path, polylines: [{ closed: true, points: [] }, ...lines.slice(1)] };
      if (difference === 'cubic')
        path = {
          ...path,
          curves: [
            {
              ...curve,
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 1, y: 3 },
                  control2: { x: 6, y: -3 },
                  to: { x: 8, y: 0 },
                },
                ...curve.segments.slice(1),
              ],
            },
            ...exact.curves!.slice(1),
          ],
        };
      if (difference === 'arc')
        path = {
          ...path,
          curves: [
            {
              ...curve,
              segments: [
                {
                  kind: 'elliptical-arc',
                  radiusX: 4,
                  radiusY: 4,
                  rotationDeg: 0,
                  largeArc: false,
                  sweep: true,
                  to: { x: 8, y: 0 },
                },
                ...curve.segments.slice(1),
              ],
            },
            ...exact.curves!.slice(1),
          ],
        };
      const restored = read(serializeProject(projectFor([path])));
      expect(firstPath(restored).curves).toEqual(path.curves);
      expect(compileJob(restored.scene, restored.device).groups).toEqual(
        compileJob(projectFor([path]).scene, restored.device).groups,
      );
    },
  );

  it('keeps hole topology, thin highlights, preview, SVG and actual emitted G-code identical after compact round trip', () => {
    const original = projectFor([exact]);
    // Identity Y mapping makes the independent scanline width probe readable.
    const canonical: Project = { ...original, device: { ...original.device, origin: 'rear-left' } };
    const restored = read(serializeProject(canonical));
    expect(firstPath(restored).curves).toBeUndefined();
    expect(firstPath(restored).polylines).toEqual(exact.polylines);
    expect(coloredPathsToSvg([firstPath(restored)], 10, 8)).toBe(coloredPathsToSvg([exact], 10, 8));
    expect(exportSceneSvg(restored)).toEqual(exportSceneSvg(canonical));
    const expectedJob = compileJob(canonical.scene, canonical.device);
    expect(compileJob(restored.scene, restored.device).groups).toEqual(expectedJob.groups);
    const expected = emitGcode(canonical).gcode;
    expect(expected.length).toBeGreaterThan(100);
    expect(emitGcode(restored).gcode).toBe(expected);
    const fill = expectedJob.groups.find((group) => group.kind === 'fill');
    if (fill?.kind !== 'fill') throw new Error('Expected filled output');
    // On a scanline through the hole the total ink width is 8 - 3 + .017 mm.
    const rows = new Map<number, number>();
    for (const segment of fill.segments) {
      const a = segment.polyline[0]!;
      const b = segment.polyline.at(-1)!;
      rows.set(a.y, (rows.get(a.y) ?? 0) + Math.abs(b.x - a.x));
    }
    const widths = [...rows].filter(([y]) => y > 12.1 && y < 13.9).map(([, width]) => width);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((width) => Math.abs(width - 5.017) < 1e-9)).toBe(true);
  });

  it('keeps raster luma byte-identical for transformed compact geometry after round trip', () => {
    const before = projectFor([exact]);
    const source = before.scene.objects[0] as TracedImage;
    const canonical = {
      ...source,
      transform: { ...source.transform, rotationDeg: 37, mirrorX: true },
    };
    const compact = { ...canonical, paths: canonical.paths.map(withoutCurves) };
    const encode = (raster: { luma: Uint8Array }) => ({
      dataUrl: '',
      lumaBase64: lumaToBase64(raster.luma),
    });
    const options = {
      dpi: 254,
      brightnessPercent: 0,
      renderType: 'fill-all' as const,
      preserveCoverage: true,
    };
    expect(assembleBitmap([compact], encode, 'raster', options)).toEqual(
      assembleBitmap([canonical], encode, 'raster', options),
    );
  });

  it('continues v1 one-way migration, including empty-polyline filtering and exact output', () => {
    const legacy = projectFor([
      { ...withoutCurves(exact), polylines: [{ closed: true, points: [] }, ...exact.polylines] },
    ]);
    const raw = { ...legacy, schemaVersion: 1 };
    const migrated = read(JSON.stringify(raw));
    expect(firstPath(migrated).curves).toEqual(exact.curves);
    expect(firstPath(migrated).polylines).toEqual(exact.polylines);
    const roundTrip = read(serializeProject(migrated));
    expect(exportSceneSvg(roundTrip)).toEqual(exportSceneSvg(migrated));
    expect(emitGcode(roundTrip).gcode).toBe(emitGcode(migrated).gcode);
  });

  it('keeps the existing line-curve promotion contract for ordinary imported SVG', () => {
    const photo = projectFor([withoutCurves(exact)]);
    const project: Project = {
      ...photo,
      scene: {
        ...photo.scene,
        objects: [{ ...(photo.scene.objects[0] as TracedImage), kind: 'imported-svg' }],
      },
    };
    expect(firstPath(read(serializeProject(project))).curves).toEqual(exact.curves);
  });

  it('continues rejecting invalid coordinates before manual and autosave publication', () => {
    const invalid = projectFor([
      { ...exact, polylines: [{ closed: true, points: [{ x: NaN, y: 0 }] }] },
    ]);
    expect(prepareProjectForPersistence(invalid).kind).toBe('invalid');
    expect(prepareProjectForAutosave(invalid).kind).toBe('invalid');
  });
});
