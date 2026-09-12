import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CncTool } from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { useStore } from '../../ui/state';
import { resetStore } from '../../ui/state/test-helpers';
import { layerWithCncMaterial } from '../../ui/state/cnc-project-material';
import { sceneAfterMachineSetup } from '../../ui/state/cnc-machine-setup-scene';
import {
  cncStartupOperationDraft,
  sceneWithCncStartupOperationDrafts,
} from '../../ui/state/cnc-startup-setup';
import {
  field,
  layerWith,
  machine,
  profile,
  projectFor,
  rectangle,
  renderFields,
  roundTrip,
  settingsFor,
} from './settings-fixtures';

afterEach(resetStore);

describe('S1: untouched CNC controls retain exact persisted ownership', () => {
  it.each([
    ['Cut depth', 'depthMm', 0.02],
    ['Depth per pass', 'depthPerPassMm', 0.01],
    ['Feed', 'feedMmPerMin', 0.5],
    ['Plunge', 'plungeMmPerMin', 0.5],
    ['Artwork spindle speed', 'spindleRpm', 500],
    ['Tab height', 'tabHeightMm', 0.02],
    ['Tab width', 'tabWidthMm', 0.2],
    ['Tabs per shape', 'tabsPerShape', 23],
  ] as const)('leaves %s unchanged on focus/blur', async (label, key, value) => {
    const project = roundTrip(projectFor(layerWith({ [key]: value, tabsEnabled: true })));
    expect(settingsFor(project)[key]).toBe(value);
    const view = await renderFields(project);
    try {
      const input = field(view.host, label);
      expect(input.value).toBe(String(value));
      await act(async () => {
        input.focus();
        input.blur();
      });
      const state = useStore.getState();
      expect(state.project).toBe(project);
      expect(settingsFor(state.project)[key]).toBe(value);
      expect(state.dirty).toBe(false);
      expect(state.undoStack).toHaveLength(0);
    } finally {
      await view.dispose();
    }
  });
});

describe('S5: calculator material and recipe are one saved operation', () => {
  it('applies job material to a manual operation and survives ordinary Save/reload and undo', async () => {
    const jobMachine = { ...machine, stock: { ...machine.stock, materialKey: 'hardwood' } };
    const before = roundTrip(projectFor(layerWith(), jobMachine));
    expect(settingsFor(before).materialKey).toBeUndefined();
    expect(prepareProjectForPersistence(before).kind).toBe('ok');
    const view = await renderFields(before);
    try {
      const apply = [...view.host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Apply to layer',
      );
      if (apply === undefined) throw new Error('Missing calculator Apply');
      expect(apply.disabled).toBe(false);
      await act(async () => apply.click());
      const after = useStore.getState().project;
      expect(settingsFor(after)).toMatchObject({
        materialKey: 'hardwood',
        feedSource: { kind: 'material-recipe', materialKey: 'hardwood', fluteCount: 2 },
      });
      expect(prepareProjectForPersistence(after).kind).toBe('ok');
      expect(settingsFor(roundTrip(after))).toEqual(settingsFor(after));
      expect(useStore.getState().undoStack).toHaveLength(1);
      await act(async () => useStore.getState().undo());
      expect(settingsFor(useStore.getState().project)).toEqual(settingsFor(before));
      await act(async () => useStore.getState().redo());
      expect(settingsFor(useStore.getState().project)).toEqual(settingsFor(after));
    } finally {
      await view.dispose();
    }
  });
});

describe('S2: automatic flute assumptions belong to the newly selected cutter', () => {
  it.each([undefined, 3])(
    'uses cutter metadata or the same fallback for Tool Plan and job default (%s)',
    (flutes) => {
      const oldTool: CncTool = {
        id: 'known-four-flute',
        name: 'Four flute',
        kind: 'end-mill',
        diameterMm: 3.175,
        fluteCount: 4,
      };
      const newTool: CncTool = {
        id: 'new-tool',
        name: 'New cutter',
        kind: 'end-mill',
        diameterMm: 3.175,
        ...(flutes === undefined ? {} : { fluteCount: flutes }),
      };
      const oldMachine = { ...machine, tools: [oldTool, newTool], toolId: oldTool.id };
      const old = layerWithCncMaterial({
        layer: layerWith(),
        machine: oldMachine,
        profile,
        materialKey: 'hardwood',
      });
      expect(old.cnc?.feedMmPerMin).toBe(1920);
      const scene = { layers: [old], objects: [rectangle()] };
      const drafts = [{ ...cncStartupOperationDraft(old), toolId: newTool.id }];
      const assigned = sceneWithCncStartupOperationDrafts({
        scene,
        machine: oldMachine,
        profile,
        liveCaps: null,
        drafts,
      }).layers[0];
      const defaultChanged = sceneAfterMachineSetup(
        scene,
        oldMachine,
        profile,
        { ...oldMachine, toolId: newTool.id },
        null,
      ).layers[0];
      const expectedFlutes = flutes ?? 2;
      const expectedFeed = 12000 * expectedFlutes * 0.04;
      expect(assigned?.cnc?.feedSource).toMatchObject({ fluteCount: expectedFlutes });
      expect(assigned?.cnc?.feedMmPerMin).toBe(expectedFeed);
      expect(defaultChanged?.cnc?.feedMmPerMin).toBe(expectedFeed);
      useStore.setState({
        project: projectFor(old, oldMachine),
        cachedCncMachine: oldMachine,
        undoStack: [],
        redoStack: [],
        dirty: false,
      });
      useStore.getState().replaceCncStartupSetup(profile, oldMachine, oldMachine, {
        operationDrafts: drafts,
        customTools: [],
        materialApplyRequested: false,
      });
      const saved = useStore.getState().project;
      expect(settingsFor(saved)).toEqual(assigned?.cnc);
      expect(useStore.getState().undoStack).toHaveLength(1);
      expect(prepareProjectForPersistence(saved).kind).toBe('ok');
      expect(settingsFor(roundTrip(saved))).toEqual(settingsFor(saved));
    },
  );
});
