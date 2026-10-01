import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, LAYER_DEFAULTS } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { rememberLastMachine } from './last-machine-persistence';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const machine = {
  ...DEFAULT_DEVICE_PROFILE,
  name: 'Saved workshop',
  bedWidth: 321,
  bedHeight: 234,
};

function addArtwork(id: string) {
  useStore.getState().importSvgObject(svgObj(id, ['#ff0000']));
  const operation = useStore.getState().project.scene.layers.at(-1);
  if (operation === undefined) throw new Error('Expected an operation');
  return operation;
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});
afterEach(() => {
  localStorage.clear();
  resetStore();
});

describe('new canvas and saved application state', () => {
  it('restores the saved machine on a fresh store without carrying a job or undo action', async () => {
    rememberLastMachine(localStorage, machine);
    vi.resetModules();
    const { useStore: restarted } = await import('./store');
    expect(restarted.getState().project.device).toEqual(machine);
    expect(restarted.getState().project.workspace).toMatchObject({ width: 321, height: 234 });
    expect(restarted.getState().project.scene.objects).toEqual([]);
    expect(restarted.getState().dirty).toBe(false);
    expect(restarted.getState().undoStack).toEqual([]);
  });

  it('New resets ordinary operation and job edits while retaining the machine', () => {
    useStore.getState().replaceDeviceProfile(machine);
    const operation = addArtwork('old');
    useStore.getState().setLayerParam(operation.id, { power: 73, speed: 987, passes: 3 });
    useStore.getState().setJobPlacement({ startFrom: 'current-position', anchor: 'center' });
    useStore
      .getState()
      .setOutputScopeSettings({ cutSelectedGraphics: true, useSelectionOrigin: true });
    useStore.getState().newProject();
    expect(useStore.getState().project.device).toEqual(machine);
    expect(useStore.getState().project.jobSetup).toEqual(createProject(machine).jobSetup);
    expect(useStore.getState().project.scene.objects).toEqual([]);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(addArtwork('new')).toMatchObject({
      power: LAYER_DEFAULTS.power,
      speed: LAYER_DEFAULTS.speed,
      passes: LAYER_DEFAULTS.passes,
    });
  });

  it.each(['colour', 'all'] as const)(
    'New keeps the %s saved preset for explicit reuse only',
    (scope) => {
      const operation = addArtwork('old');
      useStore.getState().setLayerParam(operation.id, { power: 73, speed: 987, passes: 3 });
      if (scope === 'colour') useStore.getState().makeLayerDefault(operation.id);
      else useStore.getState().makeLayerDefaultForAll(operation.id);
      useStore.getState().newProject();
      const fresh = addArtwork('new');
      expect(fresh).toMatchObject({
        power: LAYER_DEFAULTS.power,
        speed: LAYER_DEFAULTS.speed,
        passes: 1,
      });
      useStore.getState().resetLayerToDefault(fresh.id);
      expect(
        useStore.getState().project.scene.layers.find((layer) => layer.id === fresh.id),
      ).toMatchObject({
        power: 73,
        speed: 987,
        passes: 3,
      });
    },
  );

  it('opening a saved project retains its operation and job values after New', () => {
    const operation = addArtwork('saved');
    useStore.getState().setLayerParam(operation.id, { power: 73, speed: 987, passes: 3 });
    useStore.getState().setJobPlacement({ startFrom: 'current-position', anchor: 'center' });
    const saved = serializeProject(useStore.getState().project);
    useStore.getState().newProject();
    const opened = deserializeProject(saved);
    if (opened.kind !== 'ok') throw new Error('Expected a saved project');
    useStore.getState().setProject(opened.project);
    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      power: 73,
      speed: 987,
      passes: 3,
    });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'current-position',
      anchor: 'center',
    });
  });
});
