import { beforeEach, describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { applyDesignSketch } from '../state/design-apply-mutation';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { sessionSketch } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { clearPersistedSession, writePersistedSession } from './design-session-storage';
import { restoreProjectDesignSession } from './project-design-session';

const sketch: Sketch = {
  layers: [DEFAULT_DESIGN_LAYER],
  entities: [
    {
      id: 'arc',
      kind: 'arc',
      center: { x: 40, y: 35 },
      radiusMm: 11,
      startAngleDeg: 23,
      sweepDeg: -225,
    },
    { id: 'guide', kind: 'line', start: { x: 1, y: 2 }, end: { x: 80, y: 90 }, construction: true },
    {
      id: 'rect',
      kind: 'rect',
      origin: { x: 1, y: 2 },
      widthMm: 30,
      heightMm: 20,
      cornerRadiusMm: 3,
    },
  ],
};

function appliedProject() {
  const applied = applyDesignSketch(
    { project: createProject(), undoStack: [] },
    sketch,
    ['arc-output', 'guide-unused', 'rect-output'],
    null,
    { activeLayerId: DEFAULT_DESIGN_LAYER.id, surface3d: false },
  );
  if (applied === null) throw new Error('apply failed');
  return applied.project;
}

beforeEach(() => {
  resetStore();
  clearPersistedSession();
  useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
});

describe('project-owned vector source', () => {
  it('survives actual file serialization, fresh store/profile restoration, and replacement Apply', () => {
    const reopened = deserializeProject(serializeProject(appliedProject()));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    localStorage.clear();
    useStore.setState({ project: reopened.project, projectDocumentEpoch: 1 });
    useDesignStudioStore.getState().openStudio();
    const session = useDesignStudioStore.getState().session!;
    expect(sessionSketch(session)).toEqual(sketch);
    expect(session.activeLayerId).toBe(DEFAULT_DESIGN_LAYER.id);
    expect(session.dirtySinceApply).toBe(false);
    expect([...session.applied!.objectIds]).toEqual(['arc-output', 'rect-output']);
    const updated: Sketch = {
      ...sketch,
      entities: sketch.entities.map((entity) =>
        entity.kind === 'arc' ? { ...entity, radiusMm: 15 } : entity,
      ),
    };
    const reapplied = applyDesignSketch(
      { project: reopened.project, undoStack: [] },
      updated,
      ['new-arc', 'unused', 'new-rect'],
      session.applied,
    )!;
    expect(reapplied.project.scene.objects.map((object) => object.id)).toEqual([
      'new-arc',
      'new-rect',
    ]);
    expect(reapplied.project.scene.layers.map((layer) => layer.id)).toEqual(
      reopened.project.scene.layers.map((layer) => layer.id),
    );
    expect(reapplied.project.designStudioDocument?.sketch).toEqual(updated);
  });

  it('discards stale in-memory and global recovery sketches when opening another project', () => {
    writePersistedSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: false,
      applied: null,
    });
    useDesignStudioStore.getState().openStudio();
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(sketch);
    useDesignStudioStore.getState().closeStudio();
    useStore.setState({ project: createProject(), projectDocumentEpoch: 1 });
    useDesignStudioStore.getState().openStudio();
    expect(sessionSketch(useDesignStudioStore.getState().session!).entities).toHaveLength(0);
    useStore.setState({ project: appliedProject(), projectDocumentEpoch: 2 });
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(sketch);
  });

  it('preserves main-workspace changes and only retains replacement ownership for matching geometry', () => {
    const project = appliedProject();
    const moved = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) =>
          object.id === 'rect-output'
            ? { ...object, transform: { ...object.transform, x: 100 } }
            : object,
        ),
      },
    };
    const session = restoreProjectDesignSession(moved);
    expect(sessionSketch(session).entities.map((entity) => entity.id)).toEqual(['arc', 'guide']);
    expect([...session.applied!.objectIds]).toEqual(['arc-output']);
    const reapplied = applyDesignSketch(
      { project: moved, undoStack: [] },
      sessionSketch(session),
      ['new-arc', 'unused'],
      session.applied,
    )!;
    expect(
      reapplied.project.scene.objects.find((object) => object.id === 'rect-output')?.transform.x,
    ).toBe(100);
    expect(reapplied.project.scene.objects).toHaveLength(2);
  });

  it('saves guides without generating machine artwork', () => {
    const guides: Sketch = { entities: sketch.entities.filter((entity) => entity.construction) };
    const result = applyDesignSketch({ project: createProject(), undoStack: [] }, guides, [
      'unused',
    ])!;
    expect(result.project.scene.objects).toHaveLength(0);
    const restored = deserializeProject(serializeProject(result.project));
    if (restored.kind !== 'ok') throw new Error('guide project failed');
    expect(sessionSketch(restoreProjectDesignSession(restored.project))).toEqual(guides);
  });

  it.each([
    { sketch: { entities: [{ ...sketch.entities[0], sweepDeg: 1e308 }] } },
    { appliedEntityObjectIds: [] },
    {
      appliedEntityObjectIds: [
        ['arc', 'arc-output'],
        ['rect', 'arc-output'],
      ],
    },
    { appliedObjectIds: ['unrelated'] },
    { appliedOperationsByLayer: [['missing-layer', 'some-op']] },
    { version: 9 },
    { sketch: { entities: [{ id: 'bad', kind: 'arc' }] } },
    { sketch: { entities: [sketch.entities[0], sketch.entities[0]] } },
    { sketch: { entities: [{ id: 'bad', kind: 'path', points: 'unsafe', closed: true }] } },
    {
      appliedEntityObjectIds: [
        ['a', 'b'],
        ['a', 'c'],
      ],
    },
  ])('rejects malformed authoritative authoring data: %j', (patch) => {
    const project = appliedProject();
    expect(
      deserializeProject(
        JSON.stringify({
          ...project,
          designStudioDocument: { ...project.designStudioDocument, ...patch },
        }),
      ).kind,
    ).toBe('invalid');
  });
});
