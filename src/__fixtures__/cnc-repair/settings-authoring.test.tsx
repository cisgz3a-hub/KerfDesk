import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { vcarveClearanceGroupForLayer } from '../../core/cnc/compile-cnc-operation-groups';
import { planStraightInlayPairForSettings } from '../../core/cnc/inlay-pair';
import type { CncLayerSettings, CncTool } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { useStore } from '../../ui/state';
import { resetStore } from '../../ui/state/test-helpers';
import {
  editNumber,
  field,
  layerWith,
  machine,
  onlyGroup,
  profile,
  projectFor,
  rectangle,
  renderFields,
  roundTrip,
  selectOption,
  settingsFor,
  twoMmTool,
} from './settings-fixtures';

afterEach(resetStore);

const vBit: CncTool = {
  id: 'fixture-vbit',
  name: 'Fixture 90 degree',
  kind: 'v-bit',
  diameterMm: 2,
  tipAngleDeg: 90,
};
const vMachine = { ...machine, toolId: vBit.id, tools: [...machine.tools, vBit] };

function clearingPathCount(settings: CncLayerSettings): number {
  const paths = rectangle().paths[0]?.polylines;
  if (paths === undefined) throw new Error('Missing fixture paths');
  if (settings.cutType === 'v-carve') {
    return (
      vcarveClearanceGroupForLayer(layerWith(settings), settings, paths, profile, vMachine)?.passes
        .length ?? 0
    );
  }
  const plan = planStraightInlayPairForSettings(paths, settings, twoMmTool);
  if (!plan.ok) throw new Error(plan.reason);
  return plan.femaleToolpaths.length;
}

describe('S3: direct Stepover editing reaches every active clearing operation', () => {
  it.each(['v-carve', 'inlay-pair'] as const)(
    'changes %s clearing and survives Save/reload',
    async (cutType) => {
      const layer = layerWith({
        cutType,
        depthMm: 0.4,
        vCarveFlatDepthEnabled: true,
        vClearToolId: twoMmTool.id,
        stepoverPercent: 12.5,
      });
      const project = projectFor(layer, cutType === 'v-carve' ? vMachine : machine);
      const view = await renderFields(project);
      try {
        expect(field(view.host, 'Stepover').value).toBe('12.5');
        const beforeCount = clearingPathCount(settingsFor(project));
        await editNumber(view.host, 'Stepover', '80');
        const after = useStore.getState().project;
        expect(settingsFor(after)).toEqual({ ...settingsFor(project), stepoverPercent: 80 });
        expect(prepareProjectForPersistence(after).kind).toBe('ok');
        const reopened = roundTrip(after);
        expect(settingsFor(reopened)).toEqual(settingsFor(after));
        const afterCount = clearingPathCount(settingsFor(reopened));
        expect(beforeCount).toBeGreaterThan(afterCount);
        expect(afterCount).toBeGreaterThan(0);
        expect(useStore.getState().undoStack).toHaveLength(1);
      } finally {
        await view.dispose();
      }
    },
  );

  it.each([
    { vCarveFlatDepthEnabled: false, vClearToolId: twoMmTool.id },
    { vCarveFlatDepthEnabled: true },
  ])('keeps dormant V-carve Stepover unchanged when clearing is inactive (%j)', async (patch) => {
    const project = projectFor(
      layerWith({ cutType: 'v-carve', stepoverPercent: 12.5, ...patch }),
      vMachine,
    );
    const view = await renderFields(project);
    try {
      expect(view.host.querySelector('input[aria-label="Stepover for #000000"]')).toBeNull();
      expect(useStore.getState().project).toBe(project);
    } finally {
      await view.dispose();
    }
  });
});

describe('S4: profile-lead controls retain explicit choices and dormant dimensions', () => {
  it('edits arc/line dimensions, persists the opt-out, and restores the same emitted lead after re-enabling', async () => {
    const { profileLead: _lead, ...settings } = settingsFor(
      projectFor(layerWith({ cutType: 'profile-outside' })),
    );
    const defaultProject = projectFor({ ...layerWith(settings), cnc: settings });
    const view = await renderFields(defaultProject);
    try {
      expect(onlyGroup(defaultProject).passes[0]?.kind).toBe('path3d');
      const defaultGcode = emitGcode(defaultProject).gcode;
      expect(defaultGcode.length).toBeGreaterThan(0);
      await editNumber(view.host, 'Lead radius', '2.5');
      await editNumber(view.host, 'Lead sweep', '120');
      const arcGcode = emitGcode(useStore.getState().project).gcode;
      expect(arcGcode).not.toBe(defaultGcode);
      await selectOption(view.host, 'Profile leads', 'line');
      expect(field(view.host, 'Lead length').value).toBe('2.5');
      expect(settingsFor(useStore.getState().project).profileLead).toEqual({
        shape: 'line',
        radiusMm: 2.5,
        sweepDeg: 120,
      });
      expect(emitGcode(useStore.getState().project).gcode).not.toBe(arcGcode);
      await selectOption(view.host, 'Profile leads', 'none');
      const disabled = useStore.getState().project;
      expect(settingsFor(disabled).profileLead).toEqual({
        shape: 'none',
        radiusMm: 2.5,
        sweepDeg: 120,
      });
      expect(onlyGroup(disabled).passes[0]?.kind).toBe('contour');
      expect(emitGcode(disabled).gcode).not.toBe(arcGcode);
      expect(prepareProjectForPersistence(disabled).kind).toBe('ok');
      expect(settingsFor(roundTrip(disabled))).toEqual(settingsFor(disabled));
      await selectOption(view.host, 'Cut type', 'pocket');
      expect(view.host.querySelector('select[aria-label="Profile leads for #000000"]')).toBeNull();
      await selectOption(view.host, 'Cut type', 'profile-outside');
      expect(settingsFor(useStore.getState().project).profileLead).toEqual(
        settingsFor(disabled).profileLead,
      );
      await selectOption(view.host, 'Profile leads', 'arc');
      expect(field(view.host, 'Lead sweep').value).toBe('120');
      expect(emitGcode(useStore.getState().project).gcode).toBe(arcGcode);
    } finally {
      await view.dispose();
    }
  });

  it('uses the assigned cutter radius until explicitly edited and can return to the automatic radius', async () => {
    const project = projectFor(
      layerWith({ cutType: 'profile-outside', profileLead: { shape: 'arc' } }),
    );
    const view = await renderFields(project);
    try {
      const radius = field(view.host, 'Lead radius');
      expect(radius.value).toBe('1');
      await act(async () => {
        radius.focus();
        radius.blur();
      });
      expect(useStore.getState().project).toBe(project);
      await editNumber(view.host, 'Lead radius', '2.75');
      expect(settingsFor(useStore.getState().project).profileLead?.radiusMm).toBe(2.75);
      const reset = [...view.host.querySelectorAll('button')].find((button) =>
        button.textContent?.startsWith('Use cutter radius'),
      );
      if (reset === undefined) throw new Error('Missing automatic radius action');
      await act(async () => reset.click());
      expect(settingsFor(useStore.getState().project).profileLead).toEqual({ shape: 'arc' });
      expect(field(view.host, 'Lead radius').value).toBe('1');
    } finally {
      await view.dispose();
    }
  });

  it('shows saved leads alongside the ramp precedence note without changing either value', async () => {
    const project = projectFor(
      layerWith({
        cutType: 'profile-inside',
        rampEntryDeg: 5,
        profileLead: { shape: 'arc', radiusMm: 0.02, sweepDeg: 2 },
      }),
    );
    const view = await renderFields(project);
    try {
      expect(view.host.textContent).toContain('Ramp entry controls this operation');
      for (const label of ['Lead radius', 'Lead sweep']) {
        const input = field(view.host, label);
        await act(async () => {
          input.focus();
          input.blur();
        });
      }
      expect(useStore.getState().project).toBe(project);
      expect(prepareProjectForPersistence(project).kind).toBe('ok');
    } finally {
      await view.dispose();
    }
  });

  it('keeps leads active and omits the ramp precedence note for an explicit zero ramp', async () => {
    const project = projectFor(
      layerWith({ cutType: 'profile-outside', rampEntryDeg: 0, profileLead: { shape: 'arc' } }),
    );
    const view = await renderFields(project);
    try {
      expect(view.host.textContent).not.toContain('Ramp entry controls this operation');
      expect(onlyGroup(project).passes[0]?.kind).toBe('path3d');
      expect(useStore.getState().project).toBe(project);
    } finally {
      await view.dispose();
    }
  });
});
