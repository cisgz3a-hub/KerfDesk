import { describe, expect, it } from 'vitest';
import {
  addObject,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createStar } from '../../core/shapes/primitives';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('star shape project IO', () => {
  it('roundtrips a star shape', () => {
    const shape = createStar({
      id: 'S1',
      color: '#ffff00',
      spec: { points: 5, outerRadiusMm: 12, innerRadiusRatio: 0.5 },
    });
    const base = createProject();
    const original: Project = { ...base, scene: addObject(base.scene, shape) };

    const result = deserializeProject(serializeProject(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(serializeProject(result.project)).toBe(serializeProject(original));
    }
  });

  it('reports invalid when a star shape has an out-of-range inner radius ratio', () => {
    const base = createProject();
    const malformedStar: SceneObject = {
      kind: 'shape',
      id: 'S-bad',
      color: '#ffff00',
      spec: {
        kind: 'star',
        points: 5,
        outerRadiusMm: 12,
        innerRadiusRatio: 1.5,
      },
      bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ffff00',
          polylines: [
            {
              closed: true,
              points: [
                { x: 12, y: 0 },
                { x: 24, y: 24 },
              ],
            },
          ],
        },
      ],
    } as unknown as SceneObject;
    const text = serializeProject({
      ...base,
      scene: addObject(base.scene, malformedStar),
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects\[0\]\.spec\.innerRadiusRatio/);
    }
  });
});
