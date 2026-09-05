import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Sketch, SketchRectangle } from '../../core/design';
import { DEFAULT_DESIGN_LAYER, entityDesignLayer } from '../../core/design/layers';
import { applyDesignSketch, applyCarveSettingsToOperations } from '../state/design-apply-mutation';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { applyCornerOp } from './design-corner-apply';
import {
  createDesignSession,
  restoreDesignSession,
  sessionSketch,
  withSketch,
  undoSession,
} from './design-session';
import {
  readPersistedSession,
  writePersistedSession,
  clearPersistedSession,
} from './design-session-storage';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignApply } from './use-design-apply';
import { useDesignSessionPersistence } from './use-design-session-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'rect',
  origin: { x: 0, y: 0 },
  widthMm: 30,
  heightMm: 20,
  cornerRadiusMm: 0,
};
const drawing: Sketch = { entities: [rect] };

beforeEach(() => {
  resetStore();
  useDesignStudioStore.setState({ session: null, stash: null });
  clearPersistedSession();
});
afterEach(clearPersistedSession);

function ApplyButtons() {
  const apply = useDesignApply();
  useDesignSessionPersistence();
  return (
    <button disabled={!apply.canApply} onClick={apply.apply}>
      Apply
    </button>
  );
}

it.each([false, true])(
  'chamfer retains layer and construction=%s through undo and Apply routing',
  (construction) => {
    const deep = {
      ...DEFAULT_DESIGN_LAYER,
      id: 'deep',
      name: 'Deep',
      depthMm: 6,
      toolId: 'tool-custom',
      cutType: 'pocket' as const,
    };
    const source: Sketch = {
      entities: [{ ...rect, layerId: deep.id, construction }],
      layers: [DEFAULT_DESIGN_LAYER, deep],
    };
    const next = applyCornerOp(
      source,
      { kind: 'rect', entityId: rect.id, atMm: rect.origin },
      'chamfer',
      2,
    );
    if (!next) throw new Error('expected chamfer');
    const path = next.entities[0]!;
    expect(path).toMatchObject({ id: rect.id, kind: 'path', construction, layerId: deep.id });
    expect(entityDesignLayer(path, next.layers!)).toBe(deep);
    const session = withSketch(createDesignSession(source), next);
    expect(sessionSketch(undoSession(session))).toBe(source);
    const applied = applyDesignSketch({ project: createProject(), undoStack: [] }, next, [
      'output',
    ]);
    if (construction) expect(applied).toBeNull();
    else {
      if (!applied) throw new Error('expected output');
      const stamped = applyCarveSettingsToOperations(applied, applied.carveOperations);
      expect(stamped.project.scene.layers[0]?.cnc).toMatchObject({
        cutType: 'pocket',
        depthMm: 6,
        toolId: deep.toolId,
      });
    }
  },
);

it.each(['deleted', 'construction'] as const)(
  'empty reapply clears owned output when its final entity is %s',
  async (mode) => {
    useDesignStudioStore.getState().openStudio();
    useDesignStudioStore.getState().setSketch(drawing);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ApplyButtons />));
      await act(async () => Simulate.click(host.querySelector('button')!));
      const first = useStore.getState().project;
      expect(first.scene.objects).toHaveLength(1);
      await act(async () => useStore.getState().importSvgObject(svgObj('unrelated', ['#000000'])));
      await act(async () =>
        useDesignStudioStore
          .getState()
          .setSketch({ entities: mode === 'deleted' ? [] : [{ ...rect, construction: true }] }),
      );
      const beforeClear = useStore.getState().project;
      expect(host.querySelector('button')!.disabled).toBe(false);
      await act(async () => Simulate.click(host.querySelector('button')!));
      expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
        'unrelated',
      ]);
      expect(useStore.getState().project.scene.layers.map((layer) => layer.id)).not.toContain(
        first.scene.layers[0]!.id,
      );
      expect(useDesignStudioStore.getState().session?.applied?.objectIds.size).toBe(0);
      expect(host.querySelector('button')!.disabled).toBe(true);
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toBe(beforeClear);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it('does not change a never-applied empty project or delete an operation still used by unrelated artwork', () => {
  const project = createProject();
  expect(applyDesignSketch({ project, undoStack: [] }, { entities: [] }, [])).toBeNull();
  const first = applyDesignSketch({ project, undoStack: [] }, drawing, ['owned'])!;
  const shared = {
    ...first.project,
    scene: {
      ...first.project.scene,
      objects: [
        ...first.project.scene.objects,
        { ...first.project.scene.objects[0]!, id: 'unrelated' },
      ],
    },
  };
  const cleared = applyDesignSketch(
    { project: shared, undoStack: [] },
    { entities: [] },
    [],
    first.applyRecord,
  )!;
  expect(cleared.project.scene.objects.map((object) => object.id)).toEqual(['unrelated']);
  expect(cleared.project.scene.layers).toEqual(first.project.scene.layers);
});

it.each([false, true])(
  'restores persisted dirty=%s and enables only pending replacement Apply',
  async (dirty) => {
    const first = useStore.getState().applyDesignSketch(drawing, ['owned'], null);
    writePersistedSession({
      sketch: drawing,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: true,
      applied: first,
      dirtySinceApply: dirty,
    });
    const saved = readPersistedSession();
    if (!saved) throw new Error('expected saved sketch');
    useDesignStudioStore.setState({ session: restoreDesignSession(saved), stash: null });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ApplyButtons />));
      expect(host.querySelector('button')!.disabled).toBe(!dirty);
      if (dirty) {
        await act(async () => Simulate.click(host.querySelector('button')!));
        expect(useStore.getState().project.scene.objects).toHaveLength(1);
        expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(false);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it('persists never-applied work as pending, including the real subscription flush on unmount', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ApplyButtons />));
  await act(async () => {
    useDesignStudioStore.getState().openStudio();
    useDesignStudioStore.getState().setSketch(drawing);
  });
  await act(async () => root.unmount());
  host.remove();
  const saved = readPersistedSession();
  if (!saved) throw new Error('expected saved sketch');
  expect(restoreDesignSession(saved).dirtySinceApply).toBe(true);
  expect(saved.applied).toBeNull();
  // Legacy sessions lack a trustworthy applied revision, so restoring them
  // offers an idempotent replacement instead of requiring a dummy edit.
  const { dirtySinceApply: _dirty, ...legacy } = saved;
  expect(restoreDesignSession(legacy).dirtySinceApply).toBe(true);
});
