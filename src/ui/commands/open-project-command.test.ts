import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { SceneObject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { openProjectCommand } from './open-project-command';

describe('openProjectCommand', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
  });
  afterEach(() => {
    useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE);
  });

  it('opens against the live document epoch and retains its success feedback', async () => {
    const opened = { ...projectWithLine(), notes: 'wrapper-owned document' };
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        { name: 'wrapper.lf2', text: async () => serializeProject(opened) },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const pushToast = vi.fn();

    await openProjectCommand(platform, pushToast);

    expect(useStore.getState().project.notes).toBe('wrapper-owned document');
    expect(useStore.getState().savedName).toBe('wrapper.lf2');
    expect(useStore.getState().projectOpenRequestEpoch).toBe(1);
    expect(pushToast).toHaveBeenCalledWith('Opened wrapper.lf2', 'success');
  });

  it('opens a LightBurn project on the machine already open, with no machine banner', async () => {
    useStore.getState().replaceDeviceProfile({
      ...DEFAULT_DEVICE_PROFILE,
      profileId: 'my-diode',
      name: 'My 300x200 diode',
      bedWidth: 300,
      bedHeight: 200,
    });
    useStore.setState({ dirty: false });
    const machine = useStore.getState().project.device;
    // A 10 mm circle 50 mm right of and 50 mm in from a front-left origin.
    const coaster = `<LightBurnProject><Shape Type="Ellipse" CutIndex="0" Rx="5" Ry="5"><XForm>1 0 0 1 50 50</XForm></Shape></LightBurnProject>`;
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [{ name: 'coaster.lbrn2', text: async () => coaster }],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await openProjectCommand(platform, vi.fn());

    const state = useStore.getState();
    expect(state.project.device).toEqual(machine);
    expect(state.project.workspace).toMatchObject({ width: 300, height: 200 });
    expect(state.projectBedReconciliation).toBeNull();
    expect(state.savedName).toBe('coaster.lf2');
    // Placed on this machine's 200 mm deep bed.
    expect(centreY(state.project.scene.objects[0])).toBeCloseTo(150, 6);
  });
});

function centreY(object: SceneObject | undefined): number {
  if (object?.kind !== 'imported-svg') throw new Error('circle missing');
  return (object.bounds.minY + object.bounds.maxY) / 2;
}
