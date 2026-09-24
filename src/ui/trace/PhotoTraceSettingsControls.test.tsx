import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { TraceSettingsControls } from './TraceSettingsControls';
import type { LightBurnTraceSettingOverrides } from './trace-options';

const photoPreset = TRACE_PRESETS['Photo shading']!;

describe('photo shading trace controls', () => {
  it('shows photo defaults with accessible hints and hides binary trace controls', async () => {
    const controls = await mountPhotoControls();
    expect(controls.number('Detail').value).toBe('60');
    expect(controls.number('Brightness').value).toBe('0');
    expect(controls.number('Contrast').value).toBe('0');
    expect(controls.number('Midtones').value).toBe('1');
    expect(controls.host.querySelectorAll('input[type="range"]')).toHaveLength(4);
    expect(controls.host.querySelectorAll('input[type="number"]')).toHaveLength(4);
    expect(controls.host.querySelector('select, details, input[type="checkbox"]')).toBeNull();
    expect(controls.host.textContent).toContain(
      'Light and shadow are made from fine filled lines.',
    );
    expect(controls.host.textContent).not.toContain('Threshold');
    expect(controls.host.textContent).not.toContain('Remove ink specks');
    expect(controls.host.textContent).not.toContain('Smoothness');
    expect(control(controls.host, 'Reset trace settings').disabled).toBe(true);
    for (const input of controls.host.querySelectorAll('input')) {
      const hintId = input.getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      expect(document.getElementById(hintId!)?.textContent).toBe(input.title);
    }
  });

  it('updates photo values from numbers and sliders while retaining unrelated overrides', async () => {
    const controls = await mountPhotoControls({ thresholdLuma: 90, photoBrightness: 3 });
    await controls.change('Detail slider', 82);
    await controls.change('Brightness', -14);
    await controls.change('Contrast', 25);
    await controls.change('Midtones slider', 1.8);
    expect(controls.settings()).toEqual({
      thresholdLuma: 90,
      photoDetail: 82,
      photoBrightness: -14,
      photoContrast: 25,
      photoGamma: 1.8,
    });
    expect(controls.number('Detail').value).toBe('82');
    expect(controls.number('Brightness slider').value).toBe('-14');
    expect(controls.number('Contrast slider').value).toBe('25');
    expect(controls.number('Midtones').value).toBe('1.8');
    expect(controls.host.textContent).not.toContain('Threshold');
  });

  it('bounds photo detail and tone values to the displayed ranges', async () => {
    const controls = await mountPhotoControls();
    await controls.change('Detail', 200);
    await controls.change('Brightness', -200);
    await controls.change('Contrast', 300);
    expect(controls.settings()).toEqual({
      photoDetail: 100,
      photoBrightness: -100,
      photoContrast: 100,
    });
    await controls.change('Detail', -10);
    expect(controls.settings().photoDetail).toBe(0);
  });

  it('resets photo and inherited settings to the selected photo preset', async () => {
    const controls = await mountPhotoControls(
      {
        photoDetail: 80,
        photoBrightness: -10,
        photoContrast: 30,
        thresholdLuma: 180,
        traceTransparency: true,
        smoothness: 0.4,
      },
      { ...photoPreset, photoDetail: 45, brightness: 5, contrast: 10 },
    );
    await clickControl(controls.host, 'Reset trace settings');
    expect(controls.settings()).toEqual({});
    expect(controls.number('Detail').value).toBe('45');
    expect(controls.number('Brightness').value).toBe('5');
    expect(controls.number('Contrast').value).toBe('10');
    expect(control(controls.host, 'Reset trace settings').disabled).toBe(true);
  });
});

async function mountPhotoControls(
  initial: LightBurnTraceSettingOverrides = {},
  preset: TraceOptions = photoPreset,
) {
  let settings = initial;
  function Harness() {
    const [overrides, set] = useState(initial);
    settings = overrides;
    return (
      <TraceSettingsControls
        preset={preset}
        overrides={overrides}
        onChange={set}
        sourceHasTransparency
      />
    );
  }
  const host = await mountControl(<Harness />);
  const number = (label: string): HTMLInputElement => {
    const input = host.querySelector(`[aria-label="Trace ${label}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing photo control ${label}`);
    return input;
  };
  return {
    host,
    settings: () => settings,
    number,
    change: async (label: string, value: number): Promise<void> => {
      await act(async () => {
        const input = number(label);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          String(value),
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}
