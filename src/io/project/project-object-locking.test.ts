import { describe, expect, it } from 'vitest';
import { addObject, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project object locking IO', () => {
  it('round-trips object locked state', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: addObject(base.scene, {
        kind: 'imported-svg',
        id: 'locked-art',
        source: 'locked.svg',
        locked: true,
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        transform: IDENTITY_TRANSFORM,
        paths: [],
      }),
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.objects[0]?.locked).toBe(true);
    }
  });

  it('rejects malformed locked state', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['scene'] = {
      objects: [
        {
          kind: 'imported-svg',
          id: 'bad-lock',
          source: 'bad.svg',
          locked: 'yes',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [],
        },
      ],
      layers: [],
      groups: [],
    };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('scene.objects[0].locked');
    }
  });
});
