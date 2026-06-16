import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithObject(object: SceneObject): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: [object] } };
}

function vectorObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
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
    ...overrides,
  } as SceneObject;
}

describe('deserializeProject security validation', () => {
  it('reports invalid when an object has inverted bounds (CQ-006)', () => {
    const text = serializeProject(
      projectWithObject(
        vectorObject({ bounds: { minX: 10, minY: 0, maxX: 0, maxY: 10 } } as Partial<SceneObject>),
      ),
    );

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.objects\[0\]\.bounds/);
    }
  });

  it('reports invalid when a raster object has absurd source pixel dimensions', () => {
    const raster = {
      kind: 'raster-image',
      id: 'R1',
      source: 'big.png',
      dataUrl: 'data:image/png;base64,',
      pixelWidth: 100000,
      pixelHeight: 100000,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
    } as unknown as SceneObject;
    const result = deserializeProject(serializeProject(projectWithObject(raster)));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/pixel/i);
    }
  });

  it('reports invalid when a coordinate magnitude is absurd', () => {
    const text = serializeProject(
      projectWithObject(
        vectorObject({
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1e50, y: 0 },
                    { x: 5, y: 5 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        } as Partial<SceneObject>),
      ),
    );

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/points\[0\]\.x/);
    }
  });
});
