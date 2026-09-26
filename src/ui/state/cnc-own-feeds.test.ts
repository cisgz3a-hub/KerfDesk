import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
afterEach(resetStore);

function cncParams(): CncMachineConfig['params'] {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC mode');
  return machine.params;
}

describe('CNC Max feed and Frame speed stay apart from the laser ones', () => {
  it('takes the current speeds when a project first switches to CNC', () => {
    useStore.getState().updateDeviceProfile({ maxFeed: 4200, framingFeedMmPerMin: 3100 });

    useStore.getState().setMachineKind('cnc');

    expect(cncParams()).toMatchObject({ maxFeedMmPerMin: 4200, framingFeedMmPerMin: 3100 });
  });

  it('keeps the CNC speeds when the laser speeds change in Laser mode', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({
      params: { maxFeedMmPerMin: 1500, framingFeedMmPerMin: 900 },
    });
    useStore.getState().setMachineKind('laser');

    useStore.getState().updateDeviceProfile({ maxFeed: 12_000, framingFeedMmPerMin: 8000 });
    useStore.getState().setMachineKind('cnc');

    expect(cncParams()).toMatchObject({ maxFeedMmPerMin: 1500, framingFeedMmPerMin: 900 });
    expect(useStore.getState().project.device.maxFeed).toBe(12_000);
  });

  it('saves and reopens the CNC speeds with the project', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { maxFeedMmPerMin: 1500 } });

    const prepared = prepareProjectForPersistence(useStore.getState().project);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    const opened = deserializeProject(prepared.json);
    if (opened.kind !== 'ok') throw new Error('expected the saved file to open');
    resetStore();
    useStore.getState().setProject(opened.project);

    expect(cncParams().maxFeedMmPerMin).toBe(1500);
  });

  it('opens a CNC project saved before the split with the device speeds', () => {
    const base = useStore.getState().project;
    const legacy = deserializeProject(
      serializeProject({
        ...base,
        device: { ...base.device, maxFeed: 5000, framingFeedMmPerMin: 2500 },
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      }),
    );
    if (legacy.kind !== 'ok') throw new Error('expected the legacy file to open');

    useStore.getState().setProject(legacy.project);

    expect(cncParams()).toMatchObject({ maxFeedMmPerMin: 5000, framingFeedMmPerMin: 2500 });
  });

  it('drops a CNC speed that is not a positive number', () => {
    const base = useStore.getState().project;
    const file = serializeProject({
      ...base,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, maxFeedMmPerMin: -5 },
      },
    });

    const opened = deserializeProject(file);

    if (opened.kind !== 'ok') throw new Error('expected the file to open');
    const machine = opened.project.machine;
    expect(machine?.kind === 'cnc' ? machine.params.maxFeedMmPerMin : 'laser').toBeUndefined();
  });
});
