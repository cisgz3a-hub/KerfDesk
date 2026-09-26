import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
afterEach(resetStore);

const RED = '#ff0000';

function output(): boolean | undefined {
  return useStore.getState().project.scene.layers.find((layer) => layer.color === RED)?.output;
}

function redLayerId(): string {
  const layer = useStore.getState().project.scene.layers.find((entry) => entry.color === RED);
  if (layer === undefined) throw new Error('missing red operation');
  return layer.id;
}

function saveAndReopen(): void {
  const prepared = prepareProjectForPersistence(useStore.getState().project);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  const opened = deserializeProject(prepared.json);
  if (opened.kind !== 'ok') throw new Error('expected the saved file to open');
  resetStore();
  useStore.getState().setProject(opened.project);
}

describe('Laser and CNC keep their own Output switches (ADR-416)', () => {
  it('turning an operation off in CNC leaves it on for the laser, and back', () => {
    useStore.getState().createManualLayer(RED);
    useStore.getState().setMachineKind('cnc');
    expect(output()).toBe(true);

    useStore.getState().setLayerParam(redLayerId(), { output: false });
    useStore.getState().setMachineKind('laser');
    expect(output()).toBe(true);

    useStore.getState().setMachineKind('cnc');
    expect(output()).toBe(false);
  });

  it('keeps both switches through a save and reopen', () => {
    useStore.getState().createManualLayer(RED);
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setLayerParam(redLayerId(), { output: false });
    useStore.getState().setMachineKind('laser');

    saveAndReopen();
    expect(output()).toBe(true);
    useStore.getState().setMachineKind('cnc');

    expect(output()).toBe(false);
  });

  it('never lets a laser Make Default set the CNC Output switch', () => {
    useStore.getState().createManualLayer(RED);
    useStore.getState().setLayerParam(redLayerId(), { output: false });
    useStore.getState().makeLayerDefaultForAll(redLayerId());
    useStore.getState().setMachineKind('cnc');

    useStore.getState().createManualLayer('#00ff00');
    const green = () =>
      useStore.getState().project.scene.layers.find((layer) => layer.color === '#00ff00');
    expect(green()?.output).toBe(true);

    useStore.getState().setMachineKind('laser');
    expect(green()?.output).toBe(false);
  });
});

describe('Laser and CNC keep their own job placement (ADR-416)', () => {
  it('restores each mode its own placement after a switch and a save', () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });
    useStore.getState().setMachineKind('cnc');
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });

    useStore.getState().setJobPlacement({ startFrom: 'current-position', anchor: 'back-left' });
    useStore.getState().setMachineKind('laser');
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });

    saveAndReopen();
    useStore.getState().setMachineKind('cnc');
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'current-position',
      anchor: 'back-left',
    });
    expect(useStore.getState().project.jobSetup.placement).toEqual(
      useStore.getState().jobPlacement,
    );
  });

  it('brings a parked Absolute placement back as the machine default once homing is off', () => {
    useStore.getState().setJobPlacement({ startFrom: 'absolute', anchor: 'front-left' });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'front-left' });
    const { device } = useStore.getState().project;
    useStore.getState().updateDeviceProfile({ homing: { ...device.homing, enabled: false } });

    useStore.getState().setMachineKind('laser');

    expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');
  });
});
