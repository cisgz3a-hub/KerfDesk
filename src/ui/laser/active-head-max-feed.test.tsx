// ADR-416: outside Machine Setup, controller values and jog ceilings follow
// the head in use, so nothing done in CNC mode moves the laser's Max feed.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDetectedSettingsPatch } from '../state/detected-settings-action';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { OriginRow } from './OriginRow';
import { useJogControlPreferences } from './jog-control-preferences';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalJogToMachinePosition = useLaserStore.getState().jogToMachinePosition;

beforeEach(resetStore);
afterEach(() => {
  resetStore();
  useLaserStore.setState({
    jogToMachinePosition: originalJogToMachinePosition,
    statusReport: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
  });
});

function cncMaxFeed(): number | undefined {
  const { machine } = useStore.getState().project;
  return machine?.kind === 'cnc' ? machine.params.maxFeedMmPerMin : undefined;
}

describe('detected controller settings go to the head in use', () => {
  it('writes the reported max rate to CNC in CNC mode and leaves the laser alone', () => {
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    useStore.getState().setMachineKind('cnc');
    const before = useStore.getState().project.device;

    applyDetectedSettingsPatch({
      maxFeed: 7000,
      maxPowerS: 24000,
      laserModeEnabled: false,
      accelMmPerSec2: 800,
    });

    const { device } = useStore.getState().project;
    expect(cncMaxFeed()).toBe(7000);
    expect(device.cncSubProfile?.maxFeedMmPerMin).toBe(7000);
    expect(device.maxFeed).toBe(6000);
    expect(device.maxPowerS).toBe(before.maxPowerS);
    expect(device.laserModeEnabled).toBe(before.laserModeEnabled);
    expect(device.accelMmPerSec2).toBe(800);

    useStore.getState().undo();
    expect(cncMaxFeed()).toBe(6000);
    expect(useStore.getState().project.device.accelMmPerSec2).toBe(before.accelMmPerSec2);
  });

  it("writes the reported max rate to the laser in Laser mode and leaves CNC's alone", () => {
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setMachineKind('laser');

    applyDetectedSettingsPatch({ maxFeed: 9000 });
    expect(useStore.getState().project.device.maxFeed).toBe(9000);

    useStore.getState().setMachineKind('cnc');
    expect(cncMaxFeed()).toBe(6000);
  });
});

describe('Go to work zero', () => {
  it("caps a CNC move at CNC's own Max feed, not the laser's", async () => {
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      statusReport: { state: 'Idle' } as NonNullable<
        ReturnType<typeof useLaserStore.getState>['statusReport']
      >,
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 72, y: 31, z: 0 },
      jogToMachinePosition,
    });
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { maxFeedMmPerMin: 2000 } });
    useJogControlPreferences.setState({ requestedFeedMmPerMin: 5000 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<OriginRow disabled={false} streaming={false} />);
      });
      const button = [...host.querySelectorAll('button')].find(
        (item) => item.textContent === 'Go to work zero',
      );
      if (button === undefined) throw new Error('Go to work zero not rendered');
      await act(async () => button.click());

      expect(jogToMachinePosition).toHaveBeenCalledWith(72, 31, 2000);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });
});
