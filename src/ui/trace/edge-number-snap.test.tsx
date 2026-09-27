import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { TraceSettingsControls } from './TraceSettingsControls';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';

// ADR-437: Edge Sensitivity and Detail have one detector setting per stop, so
// a typed value between stops must not stay on screen as if it were traced.
describe('Edge Sensitivity and Detail number boxes', () => {
  it('show the stop being traced once a typed value loses focus', async () => {
    const preset = TRACE_PRESETS['Edge Detection'];
    if (preset === undefined) throw new Error('Missing Edge Detection preset');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let overrides: LightBurnTraceSettingOverrides = {};
    const render = (): void =>
      root.render(
        <TraceSettingsControls
          preset={preset}
          overrides={overrides}
          onChange={(next) => {
            overrides = next;
            render();
          }}
        />,
      );
    const field = (label: string): HTMLInputElement => {
      const input = host.querySelector(`[aria-label="Trace ${label}"]`);
      if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
      return input;
    };
    const type = (label: string, value: number): Promise<void> =>
      act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(field(label), String(value));
        field(label).dispatchEvent(new Event('input', { bubbles: true }));
      });
    const blur = (label: string): Promise<void> =>
      act(async () => {
        field(label).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
    await act(async () => render());
    try {
      await type('Sensitivity', 44);
      await type('Detail', 73);
      // While typing, the box keeps the keystrokes; the engine takes the nearest stop.
      expect(field('Sensitivity').value).toBe('44');
      const typed = mergeLightBurnTraceSettings(preset, overrides);
      await blur('Sensitivity');
      await blur('Detail');
      expect(field('Sensitivity').value).toBe('40');
      expect(field('Detail').value).toBe('75');
      expect(mergeLightBurnTraceSettings(preset, overrides)).toEqual(typed);
      // A value already on a stop is left alone, and other number boxes do not snap.
      await type('Sensitivity', 70);
      await blur('Sensitivity');
      expect(overrides.edgeSensitivity).toBe(70);
      await type('Minimum line', 37);
      await blur('Minimum line');
      expect(field('Minimum line').value).toBe('37');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
