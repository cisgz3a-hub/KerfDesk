import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MachineKind } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function resetModeHistoryState(): void {
  resetStore();
  useStore.setState({ cachedCncMachine: null });
}

beforeEach(resetModeHistoryState);
afterEach(resetModeHistoryState);

const LASER_PLACEMENT = { startFrom: 'user-origin', anchor: 'center' } as const;
const CNC_PLACEMENT = { startFrom: 'current-position', anchor: 'back-left' } as const;
const COLOR = '#ff0000';

function prepareDistinctHeads(mode: MachineKind): void {
  useStore.getState().createManualLayer(COLOR);
  useStore.getState().setJobPlacement(LASER_PLACEMENT);
  useStore.getState().setMachineKind('cnc');
  useStore.getState().setJobPlacement(CNC_PLACEMENT);
  useStore.getState().updateCncMachine({ stock: { widthMm: 88 }, params: { safeZMm: 12 } });
  const layer = useStore.getState().project.scene.layers.find((entry) => entry.color === COLOR);
  if (layer === undefined) throw new Error('expected a manual operation');
  useStore.getState().setLayerParam(layer.id, { output: false });
  useStore.getState().setMachineKind('laser');
  if (mode === 'cnc') {
    useStore.getState().setMachineKind('cnc');
    // The active CNC setup can differ from the cached setup from the last switch.
    useStore.getState().updateCncMachine({ params: { safeZMm: 15 } });
  }
}

function expectModePlacement(mode: MachineKind): void {
  const state = useStore.getState();
  const expected = mode === 'laser' ? LASER_PLACEMENT : CNC_PLACEMENT;
  expect(state.project.machine?.kind).toBe(mode);
  expect(state.jobPlacement).toEqual(expected);
  expect(state.project.jobSetup.placement).toEqual(expected);
  expect(state.project.scene.layers.find((layer) => layer.color === COLOR)?.output).toBe(
    mode === 'laser',
  );
}

function saveAndReopenCurrentSetup(): void {
  const prepared = prepareProjectForPersistence(projectWithCurrentJobSetup(useStore.getState()));
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  const opened = deserializeProject(prepared.json);
  if (opened.kind !== 'ok') throw new Error('expected the saved project to reopen');
  resetStore();
  useStore.getState().setProject(opened.project);
}

describe('mode switch history keeps the active head settings together (ADR-416)', () => {
  it.each(['laser', 'cnc'] as const)(
    'restores %s placement and CNC cache through Undo and Redo',
    (mode) => {
      prepareDistinctHeads(mode);
      const before = useStore.getState();
      const otherMode = mode === 'laser' ? 'cnc' : 'laser';

      useStore.getState().setMachineKind(otherMode);
      const switched = useStore.getState();
      expectModePlacement(otherMode);

      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before.project);
      expectModePlacement(mode);
      expect(useStore.getState().cachedCncMachine).toEqual(before.cachedCncMachine);

      useStore.getState().redo();
      expect(useStore.getState().project).toBe(switched.project);
      expectModePlacement(otherMode);
      expect(useStore.getState().cachedCncMachine).toEqual(switched.cachedCncMachine);
    },
  );

  it('saves the restored Laser placement after Undo without overwriting either head', () => {
    prepareDistinctHeads('laser');
    useStore.getState().setMachineKind('cnc');
    useStore.getState().undo();

    saveAndReopenCurrentSetup();
    expectModePlacement('laser');
    useStore.getState().setMachineKind('cnc');
    expectModePlacement('cnc');
    expect(useStore.getState().project.machine).toMatchObject({
      kind: 'cnc',
      stock: { widthMm: 88 },
      params: { safeZMm: 12 },
    });
  });
});
