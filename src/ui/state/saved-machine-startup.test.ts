import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  setDefaultSavedMachine,
  type SavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import { createProject } from '../../core/scene';
import { useStore } from './store';
import { startupProject } from './saved-machine-startup';
import { useSavedMachinesStore } from './saved-machines-store';
import { resetStore } from './test-helpers';

const ROUTER = createSavedMachine({
  id: 'router',
  profile: everyFieldProfile(),
  machineKind: 'cnc',
  name: 'Shop 4040',
  now: 1,
});
const FALCON = createSavedMachine({
  id: 'falcon',
  profile: FALCON_A1_PRO_GRBLHAL_PROFILE,
  machineKind: 'laser',
  name: 'Falcon',
  now: 1,
});

function installList(defaultMachine: SavedMachine | null): void {
  const list = addSavedMachine(addSavedMachine(EMPTY_SAVED_MACHINE_LIST, ROUTER), FALCON);
  useSavedMachinesStore.setState({
    list: setDefaultSavedMachine(list, defaultMachine?.id ?? null),
    persistFailed: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
});

describe('new projects and the default saved machine', () => {
  it('starts File > New with every setting of the default machine', () => {
    installList(ROUTER);
    useStore.setState({ project: createProject(FALCON_A1_PRO_GRBLHAL_PROFILE) });

    useStore.getState().newProject();

    const project = useStore.getState().project;
    expect(project.device).toEqual(ROUTER.profile);
    expect(project.machine?.kind).toBe('cnc');
    if (project.machine?.kind === 'cnc') {
      expect(project.machine.params).toEqual(ROUTER.profile.cncSubProfile);
    }
    expect(project.workspace).toMatchObject({ width: 380, height: 390 });
  });

  it('keeps the open machine for File > New when no default is set', () => {
    installList(null);
    const current = { ...DEFAULT_DEVICE_PROFILE, name: 'Open machine', bedWidth: 250 };
    useStore.setState({ project: createProject(current) });

    useStore.getState().newProject();

    expect(useStore.getState().project.device).toEqual(current);
  });

  it('opens KerfDesk on the default machine', () => {
    installList(FALCON);
    expect(startupProject().device).toEqual(FALCON.profile);
    expect(startupProject().machine?.kind ?? 'laser').toBe('laser');

    installList(ROUTER);
    expect(startupProject().machine?.kind).toBe('cnc');

    installList(null);
    expect(startupProject().device).toEqual(createProject().device);
  });
});
