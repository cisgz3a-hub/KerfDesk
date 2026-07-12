import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { RotarySetupDialog } from './RotarySetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('RotarySetupDialog', () => {
  it('shows wrap math and returns an enabled chuck setup', async () => {
    const onApply = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RotarySetupDialog
          setup={{ enabled: true, type: 'chuck', objectDiameterMm: 60, mmPerRotation: 360 }}
          onCancel={vi.fn()}
          onApply={onApply}
          onGenerateCalibration={vi.fn()}
        />,
      );
    });
    try {
      expect(host.textContent).toContain('Surface circumference: 188.50 mm');
      expect(host.textContent).toContain('Machine travel per revolution: 360.00 mm');
      const apply = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Apply'),
      );
      if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply button missing');
      await act(async () => apply.click());
      expect(onApply).toHaveBeenCalledWith({
        enabled: true,
        type: 'chuck',
        objectDiameterMm: 60,
        mmPerRotation: 360,
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('requires rotary enablement before generating a test pattern', async () => {
    const onGenerateCalibration = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RotarySetupDialog
          setup={undefined}
          onCancel={vi.fn()}
          onApply={vi.fn()}
          onGenerateCalibration={onGenerateCalibration}
        />,
      );
    });
    try {
      const generate = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Generate test pattern'),
      );
      if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
      expect(generate.disabled).toBe(true);
      const enable = host.querySelector('input[type="checkbox"]');
      if (!(enable instanceof HTMLInputElement)) throw new Error('Enable checkbox missing');
      await act(async () => {
        enable.checked = true;
        Simulate.change(enable);
      });
      expect(generate.disabled).toBe(false);
      await act(async () => generate.click());
      expect(onGenerateCalibration).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
