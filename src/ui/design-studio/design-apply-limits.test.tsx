// Design Studio Apply and the project's limits (ADR-307 amendment 1). Every
// entity of the drawing becomes a scene object, and a new design layer a new
// operation. A project past PROJECT_SCENE_LIMITS saves but cannot be opened
// again, so an Apply that would take it past one is refused with a notice and
// changes nothing, the drawing staying unapplied in the open Studio; an Apply
// that fits is made exactly as before.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sketch, SketchRectangle } from '../../core/design';
import { createLayer } from '../../core/scene';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  currentProject,
  expectUnchanged,
  lastToast,
  loadScene,
  OBJECT_LIMIT,
  pastTheLimit,
  rects,
  redoNames,
  undoNamedStep,
} from '../state/testing/scene-limit-fixtures';
import { useToastStore } from '../state/toast-store';
import { clearPersistedSession } from './design-session-storage';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignApply } from './use-design-apply';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ASK = 'Apply a smaller drawing, or delete some objects first.';

function rectangle(id: string, x: number): SketchRectangle {
  return { kind: 'rect', id, origin: { x, y: 0 }, widthMm: 30, heightMm: 20, cornerRadiusMm: 0 };
}

// Two rectangles: two scene objects on one new operation.
const DRAWING: Sketch = { entities: [rectangle('a', 0), rectangle('b', 40)] };

function ApplyButtons() {
  const apply = useDesignApply();
  return (
    <>
      <button disabled={!apply.canApply} onClick={apply.apply}>
        Apply
      </button>
      <button disabled={!apply.canApply} onClick={apply.applyAndClose}>
        Apply &amp; Close
      </button>
    </>
  );
}

// The Studio open on DRAWING, with its Apply and Apply & Close buttons.
async function openStudioOnDrawing() {
  useDesignStudioStore.getState().openStudio();
  useDesignStudioStore.getState().setSketch(DRAWING);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ApplyButtons />));
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((element) => element.textContent === label)!;
  return {
    button,
    click: (label: string) => act(async () => Simulate.click(button(label))),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

// Deleting one object makes room for the drawing's two.
async function deleteOneObject() {
  await act(async () => {
    useStore.getState().removeSceneObjects(['filler-0']);
  });
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  useDesignStudioStore.setState({ session: null, stash: null });
  clearPersistedSession();
});
afterEach(clearPersistedSession);

describe('Design Studio Apply and the project limits', () => {
  it('refuses an Apply that would take the project past its limit', () => {
    const before = loadScene(rects(OBJECT_LIMIT - 1), []);

    expect(useStore.getState().applyDesignSketch(DRAWING, ['d-a', 'd-b'], null)).toBe('refused');

    expectUnchanged(before);
    expect(lastToast()).toEqual({
      message: pastTheLimit('objects', OBJECT_LIMIT, ASK),
      variant: 'warning',
    });
  });

  it('applies to exactly the limit, and edits that artwork while it adds nothing more', () => {
    loadScene(rects(OBJECT_LIMIT - 2), []);
    const first = useStore.getState().applyDesignSketch(DRAWING, ['d-a', 'd-b'], null);
    if (first === null || first === 'refused') throw new Error('expected the drawing applied');
    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);

    // A second Apply replaces the first one's objects: as many again is no growth.
    const second = useStore.getState().applyDesignSketch(DRAWING, ['e-a', 'e-b'], first);
    if (second === null || second === 'refused') throw new Error('expected the edit applied');
    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(lastToast()).toBeUndefined();

    const full = currentProject();
    const larger: Sketch = { entities: [...DRAWING.entities, rectangle('c', 80)] };
    expect(useStore.getState().applyDesignSketch(larger, ['f-a', 'f-b', 'f-c'], second)).toBe(
      'refused',
    );
    expect(currentProject() === full).toBe(true);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));
  });

  it('refuses a new operation past the project limit of operations', () => {
    const layers = Array.from({ length: PROJECT_SCENE_LIMITS.layers }, (_, index) =>
      createLayer({
        id: `operation-${index}`,
        color: `#${(index + 1).toString(16).padStart(6, '0')}`,
      }),
    );
    const before = loadScene(rects(4), [], [], layers);

    expect(useStore.getState().applyDesignSketch(DRAWING, ['d-a', 'd-b'], null)).toBe('refused');

    expectUnchanged(before);
    expect(lastToast()?.message).toBe(pastTheLimit('operations', PROJECT_SCENE_LIMITS.layers, ASK));
  });

  it('leaves the name of the step waiting to be redone as it was', () => {
    loadScene(rects(OBJECT_LIMIT - 1), []);
    undoNamedStep('Tidy up');

    expect(useStore.getState().applyDesignSketch(DRAWING, ['d-a', 'd-b'], null)).toBe('refused');

    expect(redoNames()).toEqual(['Tidy up']);
  });

  it('keeps a refused drawing unapplied in the Studio, to apply once there is room', async () => {
    const before = loadScene(rects(OBJECT_LIMIT - 1), []);
    const studio = await openStudioOnDrawing();
    try {
      await studio.click('Apply');
      expectUnchanged(before);
      expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(true);
      expect(useDesignStudioStore.getState().session?.applied).toBeNull();
      expect(studio.button('Apply').disabled).toBe(false);

      await deleteOneObject();
      await studio.click('Apply');
      expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
      expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(false);
      expect(studio.button('Apply').disabled).toBe(true);
    } finally {
      await studio.close();
    }
  });

  it('keeps the Studio open on a drawing Apply & Close could not add', async () => {
    const before = loadScene(rects(OBJECT_LIMIT - 1), []);
    const studio = await openStudioOnDrawing();
    try {
      await studio.click('Apply & Close');
      expectUnchanged(before);
      expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(true);
      expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));

      await deleteOneObject();
      await studio.click('Apply & Close');
      expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
      expect(useDesignStudioStore.getState().session).toBeNull();
    } finally {
      await studio.close();
    }
  });
});
