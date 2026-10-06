/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  layerCncTool,
  type CncMachineConfig,
} from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { ProjectBedReconciliationBanner } from './ProjectBedReconciliationBanner';

let host: HTMLDivElement;
let root: Root;

const jobTool = {
  id: 'saved-six-mm',
  name: 'Saved 6 mm cutter',
  kind: 'end-mill',
  diameterMm: 6,
} as const;
const savedCncJob: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 29, materialKey: 'plywood-mdf' },
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, jobTool],
  toolId: jobTool.id,
  tiling: { tileWidthMm: 123, tileHeightMm: 234, overlapMm: 10, registrationHoles: false },
};

describe('ProjectBedReconciliationBanner', () => {
  beforeEach(() => {
    resetStore();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('discloses machine and bed changes with both nonblocking choices', async () => {
    const opened = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Opened machine',
      bedWidth: 400,
      bedHeight: 300,
    });
    useStore.getState().setProject({
      ...opened,
      workspace: { ...opened.workspace, width: 250, height: 200 },
    });

    await act(async () => root.render(<ProjectBedReconciliationBanner />));

    expect(host.textContent).toContain('Opened project machine');
    expect(host.textContent).toContain('250 × 200 mm');
    expect(host.textContent).toContain('400 × 300 mm');
    expect(host.textContent).toContain('Use project machine');
    expect(host.textContent).toContain('Keep current machine');
  });

  it.each(['Use project machine', 'Keep current machine'])(
    '%s retains the chosen profile and clears the disclosure',
    async (label) => {
      const previous = {
        ...createProject({
          ...DEFAULT_DEVICE_PROFILE,
          name: 'Current router',
          bedWidth: 500,
          bedHeight: 450,
        }),
        // The previous canvas's stock/cutter/tiling must not enter a Laser-only file.
        machine: savedCncJob,
      };
      useStore.setState({ project: previous });
      const opened = createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Opened laser',
        bedWidth: 400,
        bedHeight: 300,
      });
      useStore.getState().setProject(opened);
      const scene = useStore.getState().project.scene;
      await act(async () => root.render(<ProjectBedReconciliationBanner />));
      const button = [...host.querySelectorAll('button')].find(
        (item) => item.textContent === label,
      );
      if (button === undefined) throw new Error('Missing reconciliation choice');
      await act(async () => button.click());
      const state = useStore.getState();
      const retained = label === 'Keep current machine' ? previous : opened;
      const retainedHardware = {
        ...previous.machine.params,
        maxFeedMmPerMin: previous.device.maxFeed,
        framingFeedMmPerMin: previous.device.framingFeedMmPerMin,
      };
      const expectedDevice =
        label === 'Keep current machine'
          ? { ...previous.device, cncSubProfile: retainedHardware }
          : opened.device;
      const expectedMachine =
        label === 'Keep current machine'
          ? { ...DEFAULT_CNC_MACHINE_CONFIG, params: retainedHardware }
          : opened.machine;
      expect(state.project.device).toEqual(expectedDevice);
      expect(state.project.machine).toEqual(expectedMachine);
      expect(state.project.workspace).toMatchObject({
        width: retained.device.bedWidth,
        height: retained.device.bedHeight,
      });
      expect(state.project.scene).toBe(scene);
      expect(state.projectBedReconciliation).toBeNull();
      expect(host.textContent).toBe('');
    },
  );

  it('keeps exact CNC hardware and its mirror while retaining the opened CNC job', async () => {
    const hardware = {
      ...DEFAULT_CNC_MACHINE_CONFIG.params,
      safeZMm: 10,
      spindleMaxRpm: 18000,
      spindleSpinupSec: 2,
      maxFeedMmPerMin: 6200,
      framingFeedMmPerMin: 1700,
    };
    const previous = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Current router',
        bedWidth: 500,
        bedHeight: 450,
      }),
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, params: hardware },
    };
    // This older active-CNC setup has no device mirror to restore blindly.
    expect(previous.device.cncSubProfile).toBeUndefined();
    useStore.setState({ project: previous });
    const base = createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'Opened router' });
    const opened = {
      ...base,
      machine: { ...savedCncJob, params: { ...savedCncJob.params, safeZMm: 19 } },
      scene: {
        ...base.scene,
        layers: [
          {
            ...createLayer({ id: 'saved-operation', color: '#ff0000' }),
            cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: jobTool.id },
          },
        ],
      },
    };
    useStore.getState().setProject(opened);
    const scene = useStore.getState().project.scene;
    await act(async () => root.render(<ProjectBedReconciliationBanner />));
    const button = [...host.querySelectorAll('button')].find(
      (item) => item.textContent === 'Keep current machine',
    );
    if (button === undefined) throw new Error('Missing current-machine choice');
    await act(async () => button.click());

    const state = useStore.getState();
    expect(state.project.device).toEqual({ ...previous.device, cncSubProfile: hardware });
    expect(state.project.machine).toEqual({ ...opened.machine, params: hardware });
    expect(state.project.workspace).toEqual({
      ...opened.workspace,
      width: previous.device.bedWidth,
      height: previous.device.bedHeight,
    });
    expect(state.project.scene).toBe(scene);
    const layer = state.project.scene.layers[0];
    if (state.project.machine?.kind !== 'cnc' || layer?.cnc === undefined) {
      throw new Error('Expected the opened CNC operation');
    }
    expect(layerCncTool(state.project.machine, layer.cnc)).toEqual(jobTool);
    expect(state.projectBedReconciliation).toBeNull();
    expect(host.textContent).toBe('');
  });
});
