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
    traceMode: 'edge',
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
      expect(result.project).toEqual(original);
      expect(result.project.scene.objects[0]?.kind).toBe('traced-image');
      if (result.project.scene.objects[0]?.kind === 'traced-image') {
        expect(result.project.scene.objects[0].traceMode).toBe('edge');
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
});
