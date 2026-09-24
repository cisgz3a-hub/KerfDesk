import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ControlledLaserOffTravelRow } from './ControlledLaserOffTravelRow';
import { AirRestartRow, LaserPowerRows } from './DeviceProfilePowerFields';
import { ZRows } from './DeviceProfileRows';
import { SafetyZonesPanel } from './MachineSetupSafetyZones';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
});
function checkbox(label: string): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing checkbox: ${label}`);
  return node;
}
function click(text: string): void {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  act(() => node.click());
}

describe('Machine profile control audit', () => {
  it('controlled laser-off travel enable respects max feed and disable returns undefined', () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <ControlledLaserOffTravelRow value={undefined} maxFeed={500} onChange={onChange} />,
      ),
    );
    act(() => checkbox('Enable controlled laser-off seek travel').click());
    expect(onChange).toHaveBeenLastCalledWith(500);
    act(() =>
      root.render(<ControlledLaserOffTravelRow value={400} maxFeed={500} onChange={onChange} />),
    );
    act(() => checkbox('Enable controlled laser-off seek travel').click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('laser mode checkbox produces a profile patch without issuing controller commands', () => {
    const update = vi.fn();
    const device = { ...useStore.getState().project.device, laserModeEnabled: false };
    act(() => root.render(<LaserPowerRows device={device} update={update} />));
    act(() => checkbox('GRBL $32 laser mode enabled').click());
    expect(update).toHaveBeenCalledWith({ laserModeEnabled: true });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('air restart checkbox is hidden without air output and updates only the profile flag with M8', () => {
    const update = vi.fn();
    const device = useStore.getState().project.device;
    act(() =>
      root.render(
        <AirRestartRow device={{ ...device, airAssistCommand: 'none' }} update={update} />,
      ),
    );
    expect(host.querySelector('input')).toBeNull();
    act(() =>
      root.render(
        <AirRestartRow
          device={{ ...device, airAssistCommand: 'M8', airAssistRestartUnreliable: false }}
          update={update}
        />,
      ),
    );
    act(() => checkbox('Controller cannot restart air assist mid-job').click());
    expect(update).toHaveBeenCalledWith({ airAssistRestartUnreliable: true });
  });

  it('probe presence checkbox records availability without requesting a probe', () => {
    const update = vi.fn();
    act(() =>
      root.render(
        <ZRows
          device={{ ...useStore.getState().project.device, zProbePresent: false }}
          update={update}
        />,
      ),
    );
    act(() => checkbox('Z probe present').click());
    expect(update).toHaveBeenCalledExactlyOnceWith({ zProbePresent: true });
  });

  it('setup safety zones add, disable and remove the selected persisted zone', () => {
    act(() => root.render(<SafetyZonesPanel />));
    click('Add zone');
    const added = useStore.getState().project.device.noGoZones;
    expect(added).toHaveLength(1);
    expect(added[0]?.enabled).toBe(true);
    const toggle = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    expect(useStore.getState().project.device.noGoZones).toEqual([{ ...added[0], enabled: false }]);
    click('Remove');
    expect(useStore.getState().project.device.noGoZones).toEqual([]);
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
