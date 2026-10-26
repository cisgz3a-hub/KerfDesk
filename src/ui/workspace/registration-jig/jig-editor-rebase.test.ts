import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project } from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { deserializeProject } from '../../../io/project/deserialize-project';
import { serializeProject } from '../../../io/project/serialize-project';
import { rebaseJigDraft } from './jig-editor-rebase';

function withOperation(project: Project, id: string, color: string): Project {
  return {
    ...project,
    scene: { ...project.scene, layers: [...project.scene.layers, createLayer({ id, color })] },
  };
}

function expectReopenable(project: Project): void {
  expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
}

describe('jig rebase persistence integrity', () => {
  it('refuses two independently valid operations with the same colour without changing either side', () => {
    const base = createProject();
    const current = withOperation(base, 'main-added', '#ff0000');
    const draft = withOperation(base, 'draft-added', '#ff0000');
    const before = [serializeProject(current), serializeProject(draft)];
    expectReopenable(current);
    expectReopenable(draft);
    expect(rebaseJigDraft(base, current, draft)).toEqual({
      kind: 'conflict',
      conflict: 'scene-integrity',
    });
    expect([serializeProject(current), serializeProject(draft)]).toEqual(before);
  });

  it('refuses a combined 257-operation scene although both branches fit individually', () => {
    const base: Project = {
      ...createProject(),
      scene: {
        objects: [],
        layers: Array.from({ length: 255 }, (_, i) =>
          createLayer({ id: `base-${i}`, color: `#${i.toString(16).padStart(6, '0')}` }),
        ),
      },
    };
    const current = withOperation(base, 'main-added', '#ff0000');
    const draft = withOperation(base, 'draft-added', '#00ff00');
    expectReopenable(current);
    expectReopenable(draft);
    expect(rebaseJigDraft(base, current, draft)).toEqual({
      kind: 'conflict',
      conflict: 'scene-limits',
    });
    expect(current.scene.layers).toHaveLength(256);
    expect(draft.scene.layers).toHaveLength(256);
  });

  it('accepts distinct additions exactly at the operation limit and keeps their IDs and settings', () => {
    const base: Project = {
      ...createProject(),
      scene: {
        objects: [],
        layers: Array.from({ length: 254 }, (_, i) =>
          createLayer({ id: `base-${i}`, color: `#${i.toString(16).padStart(6, '0')}` }),
        ),
      },
    };
    const current = withOperation(base, 'main-added', '#ff0000');
    const draft = withOperation(base, 'draft-added', '#00ff00');
    const merged = rebaseJigDraft(base, current, draft);
    expect(merged.kind).toBe('rebased');
    if (merged.kind !== 'rebased') throw new Error('unexpected conflict');
    expect(merged.project.scene.layers).toHaveLength(256);
    expect(merged.project.scene.layers).toContain(current.scene.layers.at(-1));
    expect(merged.project.scene.layers).toContain(draft.scene.layers.at(-1));
    expectReopenable(merged.project);
  });

  it('also checks the final combined object budget', () => {
    const layer = createLayer({ id: 'art', color: '#000000' });
    const rectangle = createRectangle({
      id: 'original',
      color: layer.color,
      spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
    });
    const base: Project = {
      ...createProject(),
      scene: {
        layers: [layer],
        objects: Array.from({ length: 9999 }, (_, i) => ({ ...rectangle, id: `base-${i}` })),
      },
    };
    const current = {
      ...base,
      scene: {
        ...base.scene,
        objects: [...base.scene.objects, { ...rectangle, id: 'main-added' }],
      },
    };
    const draft = {
      ...base,
      scene: {
        ...base.scene,
        objects: [...base.scene.objects, { ...rectangle, id: 'draft-added' }],
      },
    };
    expectReopenable(current);
    expectReopenable(draft);
    expect(rebaseJigDraft(base, current, draft)).toEqual({
      kind: 'conflict',
      conflict: 'scene-limits',
    });
  });
});
