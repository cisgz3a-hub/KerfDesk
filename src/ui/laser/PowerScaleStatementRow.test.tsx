// Machine Setup's "I have checked this" row (annoyance audit A2 B3-P2-1,
// ADR-095 Amendment 1): shown only where the firmware reports no power scale,
// recorded as the operator's own statement, and labelled as that.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createOperatorPowerScaleStatement } from '../../core/devices/power-scale-statement';
import { LaserPowerRows } from './DeviceProfilePowerFields';

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

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  maxPowerS: 255,
};

function render(device: DeviceProfile, update = vi.fn()): typeof update {
  act(() => root.render(<LaserPowerRows device={device} update={update} plainLabels />));
  return update;
}

function checkbox(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label^="I have checked this"]');
}

describe('the power scale check row', () => {
  it.each(['grbl-v1.1', 'grblhal', 'fluidnc'] as const)(
    'is not offered on %s, which reports its scale',
    (controllerKind) => {
      render({ ...DEFAULT_DEVICE_PROFILE, controllerKind });
      expect(checkbox()).toBeNull();
    },
  );

  it('says what to check on Marlin and that the tick is not a KerfDesk check', () => {
    render(MARLIN);
    expect(checkbox()?.checked).toBe(false);
    expect(host.textContent).toContain('I have checked this: full power is S255 on this machine');
    expect(host.textContent).toContain('Marlin does not report its laser power scale');
    expect(host.textContent).toContain('CUTTER_POWER_UNIT');
    expect(host.textContent).toContain('KerfDesk does not test it');
    expect(host.textContent).toContain('operator-stated');
  });

  it('names the config key on Smoothieware', () => {
    render({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'smoothieware', maxPowerS: 1 });
    expect(host.textContent).toContain('laser_module_maximum_s_value');
  });

  it('records a statement for the profile as it is when ticked', () => {
    const update = render(MARLIN);
    act(() => checkbox()?.click());
    expect(update).toHaveBeenCalledExactlyOnceWith({
      operatorPowerScaleStatement: {
        maxPowerS: 255,
        controllerKind: 'marlin',
        dialectId: 'marlin-inline',
        statedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });
  });

  it('shows a standing statement as the operator statement, with its date, and clears it', () => {
    const statement = createOperatorPowerScaleStatement(MARLIN, '2026-11-11T10:00:00.000Z');
    const update = render({ ...MARLIN, operatorPowerScaleStatement: statement ?? undefined });
    expect(checkbox()?.checked).toBe(true);
    expect(host.textContent).toContain('Your statement, recorded 2026-11-11.');
    act(() => checkbox()?.click());
    expect(update).toHaveBeenCalledExactlyOnceWith({ operatorPowerScaleStatement: undefined });
  });

  it('shows a statement made for another Full-power S as not made', () => {
    const statement = createOperatorPowerScaleStatement(MARLIN, '2026-11-11T10:00:00.000Z');
    render({ ...MARLIN, maxPowerS: 100, operatorPowerScaleStatement: statement ?? undefined });
    expect(checkbox()?.checked).toBe(false);
    expect(host.textContent).not.toContain('Your statement, recorded');
  });
});
