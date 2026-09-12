import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type Project, type TextObject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithText(weldOverlaps?: boolean): Project {
  const project = createProject();
  const text: TextObject = {
    kind: 'text',
    id: 'script-text',
    content: 'my',
    fontKey: 'dancing-script-regular',
    sizeMm: 20,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    ...(weldOverlaps === undefined ? {} : { weldOverlaps }),
  };
  return { ...project, scene: { ...project.scene, objects: [text] } };
}

describe('editable text weld persistence', () => {
  it.each([true, false, undefined])(
    'round-trips weldOverlaps=%s without changing legacy intent',
    (weldOverlaps) => {
      const project = projectWithText(weldOverlaps);
      const serialized = serializeProject(project);
      const restored = deserializeProject(serialized);

      expect(restored).toEqual({ kind: 'ok', project });
      if (weldOverlaps === undefined) expect(serialized).not.toContain('weldOverlaps');
    },
  );

  it.each(['true', 1, null, [], {}])('rejects malformed weld settings (%#)', (weldOverlaps) => {
    const project = projectWithText();
    const raw = {
      ...project,
      scene: { ...project.scene, objects: [{ ...project.scene.objects[0], weldOverlaps }] },
    };

    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('weldOverlaps'),
    });
  });
});
