// ADR-408: Trace dialog settings recorded on a trace result persist through
// .lf2 save/load. They are Re-trace metadata, so older files without them load
// unchanged and a malformed or newer record is dropped instead of refusing the
// project.
import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
  type TraceSettingsRecord,
} from '../../core/scene';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

const SETTINGS: TraceSettingsRecord = {
  schemaVersion: 1,
  presetName: 'Smooth',
  overrides: {
    detectionMode: 'manual',
    cutoffLuma: 12,
    thresholdLuma: 140,
    fillPinholeCracks: true,
  },
  output: 'vector',
  fillStyle: 'offset',
  boundary: { x: 4, y: 6, width: 30, height: 20 },
  boundaryMode: 'enhance',
};

function trace(over: Partial<TracedImage> = {}): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'logo.png',
    traceSourceId: 'src-1',
    traceMode: 'filled-contours',
    tracePixelWidth: 100,
    tracePixelHeight: 80,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
            closed: true,
          },
        ],
      },
    ],
    ...over,
  };
}

function rasterTrace(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-trace',
    source: 'logo.png (bitmap)',
    traceSourceId: 'src-1',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    ...over,
  };
}

function projectWith(...objects: SceneObject[]): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

function load(text: string): Project {
  const result = deserializeProject(text);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
  return result.project;
}

function withRawSettings(value: unknown, object: SceneObject = trace()): string {
  const raw = JSON.parse(serializeProject(projectWith(object))) as {
    scene: { objects: Record<string, unknown>[] };
  };
  const first = raw.scene.objects[0];
  if (first === undefined) throw new Error('missing object');
  first['traceSettings'] = value;
  return JSON.stringify(raw);
}

describe('trace settings persistence (ADR-408)', () => {
  it('round-trips recorded settings on vector and raster trace results byte-for-byte', () => {
    const original = projectWith(
      trace({ traceSettings: SETTINGS }),
      rasterTrace({ traceSettings: { ...SETTINGS, output: 'raster' } }),
    );
    const text = serializeProject(original);
    const loaded = load(text);
    expect(serializeProject(loaded)).toBe(text);
    expect((loaded.scene.objects[0] as TracedImage).traceSettings).toEqual(SETTINGS);
    expect((loaded.scene.objects[1] as RasterImage).traceSettings?.output).toBe('raster');
  });

  it('saves a project carrying trace settings without validation drift', () => {
    const prepared = prepareProjectForPersistence(projectWith(trace({ traceSettings: SETTINGS })));
    expect(prepared.kind).toBe('ok');
  });

  it('loads an older project whose traces carry no recorded settings', () => {
    const current = JSON.parse(serializeProject(projectWith(trace()))) as Record<string, unknown>;
    expect(current['schemaVersion']).toBe(PROJECT_SCHEMA_VERSION);
    for (const version of [PROJECT_SCHEMA_VERSION, 8]) {
      const loaded = load(JSON.stringify({ ...current, schemaVersion: version }));
      const restored = loaded.scene.objects[0] as TracedImage;
      expect(restored.traceSourceId).toBe('src-1');
      expect(restored).not.toHaveProperty('traceSettings');
    }
  });

  it('loads a hand-written v8 document with a traced image and no recorded settings', () => {
    // Written by hand in the shape a v8 build saved, independent of the
    // current serializer, so a change to how old documents are read shows up.
    const loaded = load(LEGACY_V8_TRACE_DOCUMENT);
    expect(loaded.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const [source, traced] = loaded.scene.objects;
    expect(source).toMatchObject({ kind: 'raster-image', id: 'src-1', role: 'trace-source' });
    expect(traced).toMatchObject({
      kind: 'traced-image',
      id: 'trace-1',
      traceSourceId: 'src-1',
      traceMode: 'filled-contours',
    });
    expect(traced).not.toHaveProperty('traceSettings');
    expect(prepareProjectForPersistence(loaded).kind).toBe('ok');
  });

  it('keeps well-formed override keys this build does not know', () => {
    const future = { ...SETTINGS, overrides: { ...SETTINGS.overrides, futureKnob: 3 } };
    const loaded = load(withRawSettings(future));
    expect((loaded.scene.objects[0] as TracedImage).traceSettings?.overrides).toEqual(
      future.overrides,
    );
  });

  it.each([
    ['a non-object', 'Smooth'],
    ['a newer record version', { ...SETTINGS, schemaVersion: 2 }],
    ['a missing preset', { ...SETTINGS, presetName: undefined }],
    ['a blank preset', { ...SETTINGS, presetName: '  ' }],
    ['an oversized preset name', { ...SETTINGS, presetName: 'x'.repeat(500) }],
    ['non-object overrides', { ...SETTINGS, overrides: [1, 2] }],
    [
      'too many override entries',
      {
        ...SETTINGS,
        overrides: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])),
      },
    ],
    ['an unknown output', { ...SETTINGS, output: 'plasma' }],
    ['an unknown fill style', { ...SETTINGS, fillStyle: 'zigzag' }],
    ['an unknown boundary mode', { ...SETTINGS, boundaryMode: 'magic' }],
    ['a negative boundary', { ...SETTINGS, boundary: { x: -1, y: 0, width: 5, height: 5 } }],
    ['an empty boundary', { ...SETTINGS, boundary: { x: 0, y: 0, width: 0, height: 5 } }],
    ['a non-numeric boundary', { ...SETTINGS, boundary: { x: '0', y: 0, width: 5, height: 5 } }],
  ])('drops %s instead of refusing the project', (_label, value) => {
    const loaded = load(withRawSettings(value));
    const restored = loaded.scene.objects[0] as TracedImage;
    expect(restored).not.toHaveProperty('traceSettings');
    expect(restored.paths).toHaveLength(1);
    // A reloaded project saves cleanly once the bad record is gone.
    expect(prepareProjectForPersistence(loaded).kind).toBe('ok');
  });

  it.each([
    ['a nested override value', { smoothness: { deep: 1 } }],
    ['a range-shaped override value', { smoothness: [0.2, 0.8] }],
    ['a null override value', { smoothness: null }],
    ['an oversized text override', { smoothness: 'x'.repeat(500) }],
    ['a prototype-shaped override key', JSON.parse('{"__proto__":1}') as object],
    ['a malformed override key', { 'bad key': 1 }],
  ])('drops only %s and keeps the rest of the record', (_label, bad) => {
    const loaded = load(
      withRawSettings({ ...SETTINGS, overrides: { ...SETTINGS.overrides, ...bad } }),
    );
    const restored = loaded.scene.objects[0] as TracedImage;
    expect(restored.traceSettings).toEqual(SETTINGS);
    expect(Object.getPrototypeOf(restored.traceSettings?.overrides)).toBe(Object.prototype);
    expect(prepareProjectForPersistence(loaded).kind).toBe('ok');
  });

  it('keeps a well-formed record on an object rebuilt from a trace under another kind', () => {
    // Inert metadata: stripping it on load would make such an object fail the
    // ADR-204 save drift check and leave the project unsaveable.
    const svg = {
      ...trace({ traceSettings: SETTINGS }),
      kind: 'imported-svg',
    } as unknown as SceneObject;
    expect(prepareProjectForPersistence(projectWith(svg)).kind).toBe('ok');
    const loaded = load(withRawSettings(SETTINGS, svg));
    expect(loaded.scene.objects[0]).toHaveProperty('traceSettings', SETTINGS);
  });
});

const LEGACY_V8_TRACE_DOCUMENT = `{
  "schemaVersion": 8,
  "device": {
    "name": "Legacy GRBL 300x300",
    "bedWidth": 300,
    "bedHeight": 300,
    "maxFeed": 6000,
    "maxPowerS": 1000,
    "capabilities": ["grbl", "wcs"],
    "origin": "front-left",
    "homing": { "enabled": true, "direction": "front-left" },
    "autofocusCommand": ""
  },
  "workspace": { "width": 300, "height": 300, "units": "mm" },
  "jobSetup": {
    "placement": { "startFrom": "absolute", "anchor": "front-left" },
    "outputScope": { "cutSelectedGraphics": false, "useSelectionOrigin": false, "selectedObjectIds": [] }
  },
  "notes": "",
  "scene": {
    "objects": [
      {
        "kind": "raster-image",
        "id": "src-1",
        "source": "logo.png",
        "role": "trace-source",
        "dataUrl": "data:image/png;base64,AAAA",
        "pixelWidth": 1,
        "pixelHeight": 1,
        "bounds": { "minX": 0, "minY": 0, "maxX": 10, "maxY": 10 },
        "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotationDeg": 0, "mirrorX": false, "mirrorY": false },
        "color": "#808080",
        "dither": "floyd-steinberg",
        "linesPerMm": 10
      },
      {
        "kind": "traced-image",
        "id": "trace-1",
        "source": "logo.png",
        "traceSourceId": "src-1",
        "traceMode": "filled-contours",
        "tracePixelWidth": 1,
        "tracePixelHeight": 1,
        "bounds": { "minX": 0, "minY": 0, "maxX": 10, "maxY": 10 },
        "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotationDeg": 0, "mirrorX": false, "mirrorY": false },
        "paths": [
          {
            "color": "#000000",
            "polylines": [
              { "points": [{ "x": 0, "y": 0 }, { "x": 10, "y": 0 }, { "x": 10, "y": 10 }], "closed": true }
            ]
          }
        ]
      }
    ],
    "layers": []
  }
}`;
