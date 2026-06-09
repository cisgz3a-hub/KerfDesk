import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  PROJECT_SCHEMA_VERSION,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function aProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const layer = createLayer({ id: 'L1', color: '#ff0000' });
  const base = createProject();
  return { ...base, scene: addLayer(addObject(base.scene, obj), layer) };
}

describe('serializeProject', () => {
  it('produces deterministic output across two calls on the same input', () => {
    const p = aProject();
    expect(serializeProject(p)).toBe(serializeProject(p));
  });

  it('ends with a trailing newline (LF) and uses 2-space indent', () => {
    const text = serializeProject(createProject());
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "schemaVersion"'); // 2-space indent
    expect(text).not.toContain('\r'); // no CRLF
  });
});

describe('deserializeProject', () => {
  it('roundtrips a populated project', () => {
    const original = aProject();
    const result = deserializeProject(serializeProject(original));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project).toEqual(original);
    }
  });

  it('reports invalid for malformed JSON', () => {
    const result = deserializeProject('{ not-json');
    expect(result.kind).toBe('invalid');
  });

  it('reports invalid for a non-object root', () => {
    expect(deserializeProject('42').kind).toBe('invalid');
    expect(deserializeProject('[]').kind).toBe('invalid');
    expect(deserializeProject('null').kind).toBe('invalid');
  });

  it('reports invalid for missing schemaVersion', () => {
    const result = deserializeProject('{"device":{}}');
    expect(result.kind).toBe('invalid');
  });

  it('reports invalid when the body is missing required top-level fields (I-5)', () => {
    // schemaVersion fine, but no device/workspace/scene
    const result = deserializeProject('{"schemaVersion":1}');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device/);
    }
  });

  it('reports invalid when scene.objects is not an array (I-5)', () => {
    const result = deserializeProject(
      '{"schemaVersion":1,"device":{},"workspace":{},"scene":{"objects":null,"layers":[]}}',
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects/);
    }
  });

  it('reports invalid when required device fields have the wrong type', () => {
    const project = aProject();
    const text = serializeProject({
      ...project,
      device: { ...project.device, bedWidth: '400' } as unknown as Project['device'],
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device\.bedWidth/);
    }
  });

  it('reports invalid when a layer has malformed output settings', () => {
    const project = aProject();
    const text = serializeProject({
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...project.scene.layers[0],
            power: 'hot',
          } as unknown as Project['scene']['layers'][number],
        ],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.layers\[0\]\.power/);
    }
  });

  it('reports invalid when image layer toggles have the wrong type', () => {
    const project = aProject();
    const text = serializeProject({
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...project.scene.layers[0],
            negativeImage: 'true',
            passThrough: 'true',
            dotWidthCorrectionMm: '0.05',
          } as unknown as Project['scene']['layers'][number],
        ],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.layers\[0\]\.negativeImage/);
    }
  });

  it('reports invalid when a scene object has an unknown kind', () => {
    const project = aProject();
    const text = serializeProject({
      ...project,
      scene: {
        ...project.scene,
        objects: [{ ...project.scene.objects[0], kind: 'banana' } as unknown as SceneObject],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects\[0\]\.kind/);
    }
  });

  it('reports schema-too-new for a future version', () => {
    const text = JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 });
    const result = deserializeProject(text);
    expect(result.kind).toBe('schema-too-new');
    if (result.kind === 'schema-too-new') {
      expect(result.sawVersion).toBe(PROJECT_SCHEMA_VERSION + 1);
    }
  });

  it('reports schema-too-old for a version 0', () => {
    const result = deserializeProject('{"schemaVersion":0}');
    expect(result.kind).toBe('schema-too-old');
  });

  it('back-fills missing hatchAngleDeg + hatchSpacingMm on layers from pre-F.1 .lf2 files', () => {
    // F.1 added hatchAngleDeg + hatchSpacingMm to Layer. Older .lf2
    // files predate them. Treating missing as the LAYER_DEFAULTS values
    // keeps the schema additive without bumping schemaVersion.
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Default',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: {
        objects: [],
        layers: [
          {
            id: 'L1',
            color: '#ff0000',
            mode: 'line',
            power: 30,
            speed: 1500,
            passes: 1,
            visible: true,
            output: true,
          },
        ],
      },
    });
    const r = deserializeProject(oldShape);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const layer = r.project.scene.layers[0];
      expect(layer?.hatchAngleDeg).toBe(0);
      // Backfill follows the current LAYER_DEFAULTS (lowered 0.2 -> 0.1 in the
      // 2026-06-03 fill quality audit). Pre-F.1 files predate Fill, so adopting
      // the current default is correct.
      expect(layer?.hatchSpacingMm).toBe(0.1);
      expect(layer?.fillOverscanMm).toBe(5);
      expect(layer?.minPower).toBe(0);
      expect((layer as { readonly negativeImage?: boolean })?.negativeImage).toBe(false);
      expect((layer as { readonly passThrough?: boolean })?.passThrough).toBe(false);
      expect((layer as { readonly dotWidthCorrectionMm?: number })?.dotWidthCorrectionMm).toBe(0);
      // ADR-038: pre-unidirectional files back-fill to snake (true), matching
      // the fill they were authored against.
      expect(layer?.fillBidirectional).toBe(true);
      expect((layer as { readonly fillCrossHatch?: boolean })?.fillCrossHatch).toBe(false);
    }
  });

  it('back-fills missing optimization settings on older .lf2 files', () => {
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Default',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: { objects: [], layers: [] },
    });

    const result = deserializeProject(oldShape);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.optimization.reduceTravelMoves).toBe(true);
    }
  });

  it('reports invalid when optimization settings have the wrong type', () => {
    const text = serializeProject({
      ...aProject(),
      optimization: { reduceTravelMoves: 'sometimes' },
    } as unknown as Project);

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/optimization\.reduceTravelMoves/);
    }
  });

  it('back-fills missing letterSpacing on text objects from pre-D.1 .lf2 files', () => {
    // D.1 added letterSpacing to TextObject. Files saved before D.1 are
    // missing the field; normalizeSceneObject must fill it with the
    // default (0 = natural spacing) so the renderer doesn't see NaN.
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Default',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: {
        objects: [
          {
            kind: 'text',
            id: 'T1',
            content: 'Hello',
            fontKey: 'roboto',
            sizeMm: 10,
            alignment: 'left',
            lineHeight: 1.4,
            color: '#000000',
            bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [],
          },
        ],
        layers: [],
      },
    });
    const r = deserializeProject(oldShape);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      const obj = r.project.scene.objects[0];
      expect(obj?.kind).toBe('text');
      if (obj?.kind === 'text') {
        expect(obj.letterSpacing).toBe(0);
      }
    }
  });

  it('back-fills missing planner fields (accel + junctionDeviation) on old .lf2 files', () => {
    // Pre-planner .lf2 files had no accelMmPerSec2 / junctionDeviationMm
    // on the device profile. They must still deserialize cleanly — the
    // normalize step in deserializeProject fills sensible defaults so
    // the planner doesn't get NaN/undefined and crash.
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Old Profile',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: { objects: [], layers: [] },
    });
    const r = deserializeProject(oldShape);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.project.device.accelMmPerSec2).toBeGreaterThan(0);
      expect(r.project.device.junctionDeviationMm).toBeGreaterThan(0);
    }
  });
});
