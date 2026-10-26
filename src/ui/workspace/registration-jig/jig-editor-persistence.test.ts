import { expect, it } from 'vitest';
import { createLayer } from '../../../core/scene';
import { useStore } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import { commitJigEditorSession, createJigEditorSession } from './jig-editor-session';

it('preserves an invalid draft and main history, allowing the corrected draft to save', () => {
  resetStore();
  const state = useStore.getState();
  const session = createJigEditorSession(state);
  const draft = {
    ...session.draft,
    project: {
      ...session.draft.project,
      scene: {
        ...session.draft.project.scene,
        layers: [
          ...session.draft.project.scene.layers,
          createLayer({ id: 'draft-one', color: '#123456' }),
          createLayer({ id: 'draft-two', color: '#123456' }),
        ],
      },
    },
  };
  const edited = { ...session, draft };
  expect(commitJigEditorSession(state, edited)).toEqual({
    kind: 'refused',
    reason: 'scene-integrity',
  });
  expect(edited.draft).toBe(draft);
  expect(useStore.getState().project).toBe(state.project);
  expect(useStore.getState().undoStack).toBe(state.undoStack);
  const corrected = {
    ...draft,
    project: {
      ...draft.project,
      scene: {
        ...draft.project.scene,
        layers: draft.project.scene.layers.filter(({ id }) => id !== 'draft-two'),
      },
    },
  };
  expect(commitJigEditorSession(state, { ...edited, draft: corrected }).kind).toBe('saved');
});
