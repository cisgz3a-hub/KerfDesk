import { describe, expect, it } from 'vitest';
import {
  addObject,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const TEXT: TextObject = {
  kind: 'text',
  id: 'path-text',
  content: 'Arc',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  pathText: { guideObjectId: 'guide', offsetMm: 3, reverse: true },
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};

function projectWithPathText(): Project {
  const project = createProject();
  return { ...project, scene: addObject(project.scene, TEXT) };
}

describe('project path text', () => {
  it('round-trips guide linkage and placement settings', () => {
    const result = deserializeProject(serializeProject(projectWithPathText()));
    expect(result).toMatchObject({
      kind: 'ok',
      project: { scene: { objects: [{ pathText: TEXT.pathText }] } },
    });
  });

  it('rejects a negative path offset', () => {
    const raw = JSON.parse(serializeProject(projectWithPathText())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    raw.scene.objects[0] = {
      ...raw.scene.objects[0],
      pathText: { guideObjectId: 'guide', offsetMm: -1, reverse: false },
    };
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('offsetMm'),
    });
  });
});
