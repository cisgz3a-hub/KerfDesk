import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices/device-profile';
import { rotaryPresetsFor } from '../../core/devices/rotary-presets';
import { RotarySetupDialog } from './RotarySetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Rotary Setup presets (ADR-503)', () => {
  it('lists the Creality Rotary Kit Pro for a Falcon only', () => {
    expect(rotaryPresetsFor(FALCON_A1_PRO_GRBLHAL_PROFILE).map((preset) => preset.id)).toEqual([
      'creality-rotary-kit-pro-chuck',
    ]);
    expect(rotaryPresetsFor(DEFAULT_DEVICE_PROFILE)).toEqual([]);
  });

  it('fills in the published chuck and motion per turn, keeps the work, and cites it', async () => {
    const onApply = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RotarySetupDialog
          setup={{
            enabled: true,
            type: 'roller',
            objectDiameterMm: 70,
            mmPerRotation: 360,
            rollerDiameterMm: 25,
          }}
          onCancel={vi.fn()}
          onApply={onApply}
          onGenerateCalibration={vi.fn()}
          presets={rotaryPresetsFor(FALCON_A1_PRO_GRBLHAL_PROFILE)}
        />,
      );
    });
    try {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Rotary preset"]');
      if (select === null) throw new Error('no preset select');
      await act(async () => {
        select.value = 'creality-rotary-kit-pro-chuck';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(host.textContent).toContain('40 mm per rotation as a chuck');
      expect(host.textContent).toContain('Machine travel per revolution: 40.00 mm');
      const apply = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Apply'),
      );
      if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply button missing');
      await act(async () => apply.click());
      expect(onApply).toHaveBeenCalledWith({
        enabled: true,
        type: 'chuck',
        objectDiameterMm: 70,
        mmPerRotation: 40,
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows no preset row without published rotaries', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RotarySetupDialog
          setup={undefined}
          onCancel={vi.fn()}
          onApply={vi.fn()}
          onGenerateCalibration={vi.fn()}
          presets={[]}
        />,
      );
    });
    try {
      expect(host.querySelector('select[aria-label="Rotary preset"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
