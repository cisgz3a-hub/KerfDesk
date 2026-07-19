// CncDetectedSettingsRow — offers to fill the CNC machine from the connected
// controller's detected settings (ADR-111). Renders nothing until a controller
// reports differing values; Apply patches the CNC params (spindle) and the
// shared device (bed), never the stock.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { DEFAULT_CNC_LAYER_SETTINGS, createLayer } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { CncDetectedSettingsRow } from './CncDetectedSettingsRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({ controllerSettings: null });
});

function cncMachine(): Extract<
  ReturnType<typeof useStore.getState>['project']['machine'],
  { kind: 'cnc' }
> {
  useStore.getState().setMachineKind('cnc');
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return machine;
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const machine = cncMachine();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<CncDetectedSettingsRow machine={machine} />);
  });
  return { host, root };
}

describe('CncDetectedSettingsRow (ADR-111)', () => {
  it('renders nothing when no controller settings are present', async () => {
    useLaserStore.setState({ controllerSettings: null });
    const { host, root } = await render();
    try {
      expect(host.querySelector('button')).toBeNull();
      expect(host.textContent).toBe('');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('applies detected spindle max to params and bed to the device, not the stock', async () => {
    const detected: ControllerSettingsSnapshot = {
      maxPowerS: 24000,
      laserModeEnabled: false,
      bedWidth: 750,
      bedHeight: 610,
    };
    useLaserStore.setState({ controllerSettings: detected });
    const { host, root } = await render();
    try {
      const button = host.querySelector('button');
      if (button === null) throw new Error('Apply button missing');
      await act(async () => button.click());

      const machine = useStore.getState().project.machine;
      if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
      expect(machine.params.spindleMaxRpm).toBe(24000);
      // Bed lands on the shared device; the stock stays at its default footprint.
      expect(useStore.getState().project.device.bedWidth).toBe(750);
      expect(useStore.getState().project.device.bedHeight).toBe(610);
      expect(machine.stock.widthMm).toBe(400);
      expect(machine.stock.heightMm).toBe(400);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('applies a lower spindle ceiling and bed without rewriting manual layers', async () => {
    const manual = {
      ...createLayer({ id: 'manual', color: '#ff0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: 12000 },
    };
    const automatic = {
      ...createLayer({ id: 'automatic', color: '#00ff00' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        materialKey: 'plywood-mdf' as const,
        spindleRpm: 12000,
        feedSource: {
          kind: 'material-recipe' as const,
          materialKey: 'plywood-mdf',
          fluteCount: 2,
        },
      },
    };
    useStore.getState().setMachineKind('cnc');
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [manual, automatic] },
      },
    }));
    useLaserStore.setState({
      controllerSettings: {
        maxPowerS: 10000,
        laserModeEnabled: false,
        bedWidth: 300,
        bedHeight: 180,
      },
    });
    const { host, root } = await render();
    try {
      const button = host.querySelector('button');
      if (button === null) throw new Error('Apply button missing');
      await act(async () => button.click());

      const state = useStore.getState();
      const machine = state.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
      expect(machine.params.spindleMaxRpm).toBe(10000);
      expect(
        state.project.scene.layers.find((layer) => layer.id === 'manual')?.cnc?.spindleRpm,
      ).toBe(12000);
      expect(
        state.project.scene.layers.find((layer) => layer.id === 'automatic')?.cnc?.spindleRpm,
      ).toBe(10000);
      expect(state.project.device).toMatchObject({ bedWidth: 300, bedHeight: 180 });
      expect(state.project.workspace).toMatchObject({ width: 300, height: 180 });
      expect(state.undoStack).toHaveLength(2); // machine-kind switch + one detected-settings apply

      await act(async () => useStore.getState().undo());
      expect(
        useStore.getState().project.scene.layers.find((layer) => layer.id === 'manual')?.cnc
          ?.spindleRpm,
      ).toBe(12000);
      expect(
        useStore.getState().project.scene.layers.find((layer) => layer.id === 'automatic')?.cnc
          ?.spindleRpm,
      ).toBe(12000);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('ignores detected $30 as a spindle ceiling while the controller is in laser mode', async () => {
    useLaserStore.setState({
      controllerSettings: {
        maxPowerS: 1000,
        laserModeEnabled: true,
        bedWidth: 300,
      },
    });
    const { host, root } = await render();
    try {
      const button = host.querySelector('button');
      if (button === null) throw new Error('Apply button missing');
      await act(async () => button.click());

      const state = useStore.getState();
      const machine = state.project.machine;
      if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
      expect(machine.params.spindleMaxRpm).toBe(12000);
      expect(state.project.device.bedWidth).toBe(300);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
