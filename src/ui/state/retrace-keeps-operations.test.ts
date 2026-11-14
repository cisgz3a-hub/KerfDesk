// T24-P1-2 (tools audit T1): Re-trace Original swapped the trace's tuned
// operation for a fresh default one and dropped its name, power scale and
// per-operation overrides, so the job burned at different power, speed and
// passes. Re-trace now rebinds the new paths to the old operations by colour
// (ADR-358's re-import rule) and only makes a new operation for a colour the
// old trace lacked or when the trace mode changes (ADR-408 Amendment).
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type ColoredPath,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/effective-output';
import { applyTraceToExisting } from './scene-mutations';
import { positionTraceOverRasterSource } from './trace-placement';
import { retraceOperationsNote } from './retrace-carry';

function photo(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'art.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 400,
    pixelHeight: 300,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    color: '#808080',
    operationIds: ['op-photo'],
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function rectangle(color: string, offset = 0): ColoredPath {
  const x = 100 + offset;
  return {
    color,
    polylines: [
      {
        closed: true,
        points: [
          { x, y: 100 },
          { x: x + 40, y: 100 },
          { x: x + 40, y: 200 },
          { x, y: 200 },
        ],
      },
    ],
  };
}

function trace(
  id: string,
  paths: ReadonlyArray<ColoredPath> = [rectangle('#000000')],
  traceMode: TracedImage['traceMode'] = 'filled-contours',
): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: 'art.png',
    traceSourceId: 'photo',
    traceMode,
    tracePixelWidth: 400,
    tracePixelHeight: 300,
    bounds: { minX: 100, minY: 100, maxX: 300, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [...paths],
  };
}

const photoLayer = (): Layer => ({
  ...createLayer({ id: 'op-photo', name: 'photo', color: '#808080', mode: 'image' }),
  output: false,
});

function tuned(id: string, color: string): Layer {
  return {
    ...createLayer({ id, name: id === 'op-art' ? 'art' : id, color, mode: 'fill' }),
    power: 80,
    speed: 600,
    passes: 2,
  };
}

function project(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: [...objects], layers: [...layers] } };
}

function registered(object: TracedImage, extra: Partial<TracedImage> = {}): TracedImage {
  return { ...positionTraceOverRasterSource(photo(), object), ...extra };
}

function retrace(before: Project, incoming: TracedImage): Project {
  return applyTraceToExisting({ project: before, undoStack: [] }, 'photo', incoming, {
    replaceTraceId: incoming.id,
  }).project;
}

function find<T extends SceneObject>(p: Project, id: string): T {
  const found = p.scene.objects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found as T;
}

describe('Re-trace Original keeps the trace operations (T24-P1-2)', () => {
  it('keeps a tuned operation, the power scale, the overrides and the name', () => {
    const old = registered(trace('trace'), {
      name: 'Coaster logo',
      powerScale: 40,
      operationIds: ['op-art'],
      operationOverride: { byOperation: { 'op-art': { power: 12, hatchSpacingMm: 0.3 } } },
    });
    const before = project([photo(), old], [photoLayer(), tuned('op-art', '#2563eb')]);
    const after = retrace(before, trace('trace'));
    const replaced = find<TracedImage>(after, 'trace');

    expect(after.scene.layers).toEqual(before.scene.layers);
    expect(operationIdsForObject(replaced, after.scene.layers)).toEqual(['op-art']);
    expect(replaced.name).toBe('Coaster logo');
    expect(replaced.powerScale).toBe(40);
    expect(replaced.operationOverride).toEqual(old.operationOverride);

    // The burn itself: the override's power 12 scaled by 40 %, two passes, 600 mm/min.
    const groups = compileJob(after.scene, after.device).groups.filter(
      (group) => group.layerId === 'op-art',
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const burn = group as { power?: number; speed?: number; passes?: number };
      expect(burn.power).toBeCloseTo(12 * 0.4, 6);
      expect(burn.speed).toBe(600);
      expect(burn.passes).toBe(2);
    }
  });

  it('keeps a moved copy on the operation it shares with the original', () => {
    const original = registered(trace('orig'), { operationIds: ['op-art'] });
    const copy = registered(trace('copy'), { operationIds: ['op-art'] });
    const before = project([photo(), original, copy], [photoLayer(), tuned('op-art', '#2563eb')]);
    const after = retrace(before, trace('copy'));
    expect(after.scene.layers).toEqual(before.scene.layers);
    expect(operationIdsForObject(find(after, 'copy'), after.scene.layers)).toEqual(['op-art']);
    expect(find(after, 'orig')).toBe(original);
  });

  it('rebinds each colour to its old operation and adds one only for a new colour', () => {
    const old = registered(
      trace('trace', [
        { ...rectangle('#000000'), operationIds: ['op-a'] },
        { ...rectangle('#FF0000', 60), operationIds: ['op-b'] },
      ]),
    );
    const before = project(
      [photo(), old],
      [photoLayer(), tuned('op-a', '#2563eb'), tuned('op-b', '#dc2626')],
    );
    const incoming = trace('trace', [
      rectangle('#000000'),
      rectangle('#ff0000', 60),
      rectangle('#00ff00', 120),
    ]);
    const after = retrace(before, incoming);
    const paths = find<TracedImage>(after, 'trace').paths;
    expect(paths[0]?.operationIds).toEqual(['op-a']);
    expect(paths[1]?.operationIds).toEqual(['op-b']);
    const fresh = paths[2]?.operationIds ?? [];
    expect(fresh).toHaveLength(1);
    expect(['op-a', 'op-b', 'op-photo']).not.toContain(fresh[0]);
    expect(after.scene.layers.filter((l) => l.id === 'op-a' || l.id === 'op-b')).toEqual(
      before.scene.layers.filter((l) => l.id === 'op-a' || l.id === 'op-b'),
    );
    expect(retraceOperationsNote(old, incoming)).toBe('1 new colour has its own new operation');
  });

  it('makes a fresh Line operation when the trace mode changes to Centerline', () => {
    const old = registered(trace('trace'), { operationIds: ['op-art'], powerScale: 40 });
    const before = project([photo(), old], [photoLayer(), tuned('op-art', '#2563eb')]);
    const incoming = trace('trace', [rectangle('#000000')], 'centerline');
    const after = retrace(before, incoming);
    const replaced = find<TracedImage>(after, 'trace');
    const [operationId] = operationIdsForObject(replaced, after.scene.layers);
    const operation = after.scene.layers.find((layer) => layer.id === operationId);
    expect(operation?.mode).toBe('line');
    expect(after.scene.layers.some((layer) => layer.id === 'op-art')).toBe(false);
    expect(replaced.powerScale).toBe(40);
    expect(retraceOperationsNote(old, incoming)).toBe(
      'the trace mode changed, so it has new operations',
    );
  });

  it('applies a fill style newly chosen in the dialog to the kept operation', () => {
    const old = registered(trace('trace'), {
      operationIds: ['op-art'],
      traceSettings: {
        schemaVersion: 1,
        presetName: 'Line Art',
        overrides: {},
        fillStyle: 'scanline',
      },
    });
    const before = project([photo(), old], [photoLayer(), tuned('op-art', '#2563eb')]);
    const incoming: TracedImage = {
      ...trace('trace'),
      traceSettings: {
        schemaVersion: 1,
        presetName: 'Line Art',
        overrides: {},
        fillStyle: 'offset',
      },
      operationOverride: { mode: 'fill', fillStyle: 'offset' },
    };
    const after = retrace(before, incoming);
    const replaced = find<TracedImage>(after, 'trace');
    const operation = after.scene.layers.find((layer) => layer.id === 'op-art');
    expect(operation).toEqual(before.scene.layers.find((layer) => layer.id === 'op-art'));
    const effective = effectiveOperationForObject(operation!, replaced);
    expect(effective.fillStyle).toBe('offset');
    expect(effective.power).toBe(80);
    expect(retraceOperationsNote(old, incoming)).toBe('it kept its operations');
  });
});
