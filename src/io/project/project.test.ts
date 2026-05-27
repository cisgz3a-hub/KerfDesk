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
            transform: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 },
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
