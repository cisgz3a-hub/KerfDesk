import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveTarget } from '../../platform/types';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function markCurrentProjectSaved(displayName: string): SaveTarget {
  const target = { displayName, write: async () => undefined };
  const state = useStore.getState();
  state.markSaved(target, state.project, state.projectDocumentEpoch, state.projectSaveRequestEpoch);
  return target;
}

describe('saveTrackingActions (F-A11)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts clean with no saved target', () => {
    const state = useStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.savedName).toBeNull();
    expect(state.lastSaveTarget).toBeNull();
    expect(state.projectSavedRequestEpoch).toBeNull();
  });

  it('marks imported content dirty', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    expect(useStore.getState().dirty).toBe(true);
  });

  it('marks edited content dirty', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState({ dirty: false });
    useStore.getState().setLayerParam('#ff0000', { power: 60 });
    expect(useStore.getState().dirty).toBe(true);
  });

  it('marks the current project saved and remembers its exact handoff owner', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const target = markCurrentProjectSaved('my-job.lf2');
    expect(useStore.getState()).toMatchObject({
      dirty: false,
      savedName: 'my-job.lf2',
      lastSaveTarget: target,
      projectSavedRequestEpoch: 0,
    });
  });

  it('does not let an older restore failure dirty a later successful same-file handoff', async () => {
    const destinationIdentity = {};
    const olderTarget: SaveTarget = {
      displayName: 'same.lf2',
      destinationIdentity,
      write: async () => undefined,
    };
    const newerTarget: SaveTarget = {
      displayName: 'same.lf2',
      destinationIdentity,
      write: async () => undefined,
    };
    const state = useStore.getState();
    useStore.setState({ dirty: true, projectSaveRequestEpoch: 1 });
    state.markSaved(olderTarget, state.project, state.projectDocumentEpoch, 1);
    useStore.setState({ dirty: true, projectSaveRequestEpoch: 2 });
    state.markSaved(newerTarget, state.project, state.projectDocumentEpoch, 2);

    await expect(
      state.markProjectSaveUncertain(state.projectDocumentEpoch, 1, olderTarget),
    ).resolves.toBe(false);
    expect(useStore.getState()).toMatchObject({
      dirty: false,
      lastSaveTarget: newerTarget,
      projectSavedRequestEpoch: 2,
    });
  });

  it('clears target ownership when a project is loaded', () => {
    useStore.getState().markLoaded('logo.lf2');
    expect(useStore.getState()).toMatchObject({
      dirty: false,
      savedName: 'logo.lf2',
      lastSaveTarget: null,
      projectSavedRequestEpoch: null,
    });
  });

  it('clears save tracking when the project is replaced', () => {
    markCurrentProjectSaved('old.lf2');
    useStore.getState().newProject();
    expect(useStore.getState()).toMatchObject({
      dirty: false,
      savedName: null,
      lastSaveTarget: null,
      projectSavedRequestEpoch: null,
    });
  });
});
