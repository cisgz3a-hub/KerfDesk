import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRegistrationBox } from '../../core/shapes';
import { createRegistrationLayer } from '../../core/scene';
import { MAX_REGISTRATION_JIG_ANCESTORS } from '../../core/scene/registration-jig-identity';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { actions, load, trace } from './trace-part.test-support';
import { useToastStore } from './toast-store';

beforeEach(resetStore);
afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

it.each(['split', 'copy'])(
  'preserves an accepted project when %s would exceed saved jig ancestry',
  (action) => {
    load({
      ...trace(),
      registrationJig: {
        objectId: 'trace',
        boxId: 'box-a',
        ancestors: Array.from({ length: MAX_REGISTRATION_JIG_ANCESTORS }, () => ({
          sourceId: 'deleted',
          kind: 'part' as const,
        })),
      },
    });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [...state.project.scene.layers, createRegistrationLayer()],
          objects: [
            createRegistrationBox({ id: 'box-a', widthMm: 120, heightMm: 120 }),
            createRegistrationBox({ id: 'box-b', widthMm: 120, heightMm: 120, x: 150 }),
            ...state.project.scene.objects,
          ],
        },
      },
      selectedObjectId: 'trace',
      additionalSelectedIds: new Set(),
    }));
    const before = useStore.getState();
    expect(deserializeProject(serializeProject(before.project)).kind).toBe('ok');
    if (action === 'split') expect(actions.detachTracePart('trace', 0, 2)).toBeNull();
    else useStore.getState().centerSelectionInRegistrationBox();
    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.selectedObjectId).toBe(before.selectedObjectId);
    expect(after.dirty).toBe(before.dirty);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      'saved project ancestry limit',
    );
  },
);
