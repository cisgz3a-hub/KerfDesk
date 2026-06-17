import { beforeEach, describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('machine profile store actions', () => {
  beforeEach(() => resetStore());

  it('replaces the active device profile and keeps workspace dimensions in sync', () => {
    useStore.setState({ dirty: false, undoStack: [], redoStack: [] });

    useStore.getState().replaceDeviceProfile({
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      name: 'Imported 500x300',
      bedWidth: 500,
      bedHeight: 300,
    });

    const state = useStore.getState();
    expect(state.project.device.name).toBe('Imported 500x300');
    expect(state.project.workspace.width).toBe(500);
    expect(state.project.workspace.height).toBe(300);
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);

    state.undo();

    expect(useStore.getState().project.device.name).not.toBe('Imported 500x300');
  });
});
