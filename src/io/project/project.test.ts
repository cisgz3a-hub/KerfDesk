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
});
