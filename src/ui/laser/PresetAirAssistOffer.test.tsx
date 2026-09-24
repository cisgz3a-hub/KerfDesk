import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceProfile } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { AirAssistRow } from './DeviceProfilePowerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// A Falcon A1 Pro profile saved before the preset gained M8 (#796, #815).
const { airAssistRestartUnreliable: _restart, ...BEFORE_AIR } = FALCON_A1_PRO_GRBLHAL_PROFILE;
const SAVED_WITHOUT_AIR: DeviceProfile = { ...BEFORE_AIR, airAssistCommand: 'none' };

function renderRow(device: DeviceProfile, update: (patch: Partial<DeviceProfile>) => void): void {
  act(() => root.render(<AirAssistRow device={device} update={update} />));
}

describe('Air output preset offer (ADR-366)', () => {
  it("offers a saved Falcon A1 Pro with air Disabled the preset's M8 and Air restart", () => {
    const update = vi.fn();
    renderRow(SAVED_WITHOUT_AIR, update);

    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      `The ${FALCON_A1_PRO_GRBLHAL_PROFILE.name} preset uses M8 with Air restart.`,
    );
    const apply = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Use the preset\'s air settings"]',
    );
    act(() => apply?.click());

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      airAssistCommand: 'M8',
      airAssistRestartUnreliable: true,
    });
  });

  it('shows no offer once an air output is configured', () => {
    renderRow(FALCON_A1_PRO_GRBLHAL_PROFILE, vi.fn());

    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Air output command"]')).not.toBeNull();
  });
});
