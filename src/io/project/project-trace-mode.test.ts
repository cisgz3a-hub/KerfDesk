import { describe, expect, it } from 'vitest';
import {
  addObject,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function edgeTraceObject(): SceneObject {
  return {
    kind: 'traced-image',
    id: 'TR-edge',
    source: 'edge trace',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
            closed: false,
          },
        ],
      },
    ],
    traceSourceId: 'source-photo',
    tracePixelWidth: 2048,
    tracePixelHeight: 1365,
    traceMode: 'edge',
  };
}

function rasterTraceObject(): SceneObject {
  return {
    kind: 'raster-image',
    id: 'TR-raster',
    source: 'edge trace (bitmap)',
    traceSourceId: 'source-photo',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

describe('project traced-image traceMode serialization', () => {
  it('roundtrips an edge traced image traceMode', () => {
    const trace = edgeTraceObject();
    const base = createProject();
    const original: Project = { ...base, scene: addObject(base.scene, trace) };

    const result = deserializeProject(serializeProject(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(serializeProject(result.project)).toBe(serializeProject(original));
      expect(result.project.scene.objects[0]?.kind).toBe('traced-image');
      if (result.project.scene.objects[0]?.kind === 'traced-image') {
        expect(result.project.scene.objects[0].traceMode).toBe('edge');
        expect(result.project.scene.objects[0].traceSourceId).toBe('source-photo');
        expect(result.project.scene.objects[0].tracePixelWidth).toBe(2048);
        expect(result.project.scene.objects[0].tracePixelHeight).toBe(1365);
      }
    }
  });

  it('reports invalid when a traced image has an unknown traceMode', () => {
    const trace = { ...edgeTraceObject(), traceMode: 'macro' } as unknown as SceneObject;
    const base = createProject();
    const text = serializeProject({
      ...base,
      scene: { ...base.scene, objects: [trace] },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects\[0\]\.traceMode/);
    }
  });

  it.each([
    ['tracePixelWidth', 0],
    ['tracePixelWidth', 1.5],
    ['tracePixelWidth', '2048'],
    ['tracePixelHeight', 0],
    ['tracePixelHeight', 1.5],
    ['tracePixelHeight', '1365'],
  ])('rejects invalid traced-image %s metadata', (field, value) => {
    const trace = { ...edgeTraceObject(), [field]: value } as unknown as SceneObject;
    const base = createProject();
    const result = deserializeProject(
      serializeProject({ ...base, scene: { ...base.scene, objects: [trace] } }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain(field);
  });

  it('roundtrips source provenance on a rasterized trace', () => {
    const raster = rasterTraceObject();
    const base = createProject();
    const original: Project = { ...base, scene: addObject(base.scene, raster) };
    const result = deserializeProject(serializeProject(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(serializeProject(result.project)).toBe(serializeProject(original));
      const restored = result.project.scene.objects[0];
      expect(restored?.kind).toBe('raster-image');
      if (restored?.kind === 'raster-image') {
        expect(restored.traceSourceId).toBe('source-photo');
      }
    }
  });

  it('rejects a non-string raster traceSourceId', () => {
    const raster = { ...rasterTraceObject(), traceSourceId: 42 } as unknown as SceneObject;
    const base = createProject();
    const result = deserializeProject(
      serializeProject({ ...base, scene: { ...base.scene, objects: [raster] } }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('traceSourceId');
  });
});
