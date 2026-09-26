import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene/machine';
import { useStore } from '../state/store';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { TraceSettingsControls } from './TraceSettingsControls';
import {
  hasAggressivePreprocessing,
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from './trace-options';
import { VISIBLE_TRACE_PRESET_NAMES } from './dialog-parts';

const colourPreset = TRACE_PRESETS['Colour layers']!;
const lineArtPreset = TRACE_PRESETS['Line Art']!;

describe('Colour layers trace controls', () => {
  it('is a visible preset and leaves every other preset unchanged', () => {
    expect(VISIBLE_TRACE_PRESET_NAMES).toContain('Colour layers');
    for (const name of Object.keys(TRACE_PRESETS)) {
      if (name === 'Colour layers') continue;
      expect(TRACE_PRESETS[name]?.colourLayers).toBeUndefined();
    }
    // Colour-layer overrides never leak into a line preset's options.
    const overrides: LightBurnTraceSettingOverrides = {
      colourCount: 5,
      colourLayerOutput: 'stacked',
      keepBackground: true,
    };
    expect(mergeLightBurnTraceSettings(lineArtPreset, overrides)).toEqual(lineArtPreset);
  });

  it('offers Auto and 2..8 colours, cut-out or stacked, background and speck size', async () => {
    const controls = await mountColourControls();
    const colours = controls.select('Colours');
    expect(colours.value).toBe('auto');
    expect([...colours.options].map((option) => option.value)).toEqual([
      'auto',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(controls.select('Layers').value).toBe('cut-out');
    expect(controls.input('Trace background colour').checked).toBe(false);
    expect(controls.input('Trace Remove specks').value).toBe('12');
    expect(controls.host.textContent).not.toContain('Threshold');
    expect(control(controls.host, 'Reset trace settings').disabled).toBe(true);
  });

  it('writes the choices into the colour-layer options', async () => {
    const controls = await mountColourControls();
    await controls.choose('Colours', '4');
    await controls.choose('Layers', 'stacked');
    await controls.click('Trace background colour');
    expect(controls.settings()).toEqual({
      colourCount: 4,
      colourLayerOutput: 'stacked',
      keepBackground: true,
    });
    expect(mergeLightBurnTraceSettings(colourPreset, controls.settings()).colourLayers).toEqual({
      colours: 4,
      output: 'stacked',
      keepBackground: true,
    });
    await controls.choose('Colours', 'auto');
    expect(
      mergeLightBurnTraceSettings(colourPreset, controls.settings()).colourLayers?.colours,
    ).toBeUndefined();
    await clickControl(controls.host, 'Reset trace settings');
    expect(controls.settings()).toEqual({});
  });

  it('previews the traced colours lightest first with their starting power', async () => {
    const controls = await mountColourControls(['#101010', '#e0e0e0', '#808080']);
    const items = [...controls.host.querySelectorAll('[aria-label="Traced colours"] li')];
    expect(items.map((item) => item.getAttribute('title')?.split(':')[0])).toEqual([
      '#e0e0e0',
      '#808080',
      '#101010',
    ]);
    // The darkest colour keeps the operation's power; lighter ones scale down.
    expect(items.map((item) => item.textContent)).toEqual(['25%', '48.4%', '100%']);
    expect(controls.host.textContent).toContain('3 layers, one operation each');
  });

  it('shows paper as off, and no power percentages on a CNC', async () => {
    const laser = await mountColourControls(['#000000', '#ffffff']);
    const labels = (host: HTMLElement): Array<string | null> =>
      [...host.querySelectorAll('[aria-label="Traced colours"] li')].map((li) => li.textContent);
    expect(labels(laser.host)).toEqual(['off', '100%']);
    expect(laser.host.textContent).toContain('Paper (near-white, or the traced background)');
    const project = useStore.getState().project;
    useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    try {
      const cnc = await mountColourControls(['#000000', '#808080']);
      expect(labels(cnc.host)).toEqual(['', '']);
      expect(cnc.host.textContent).toContain('2 layers, one operation each.');
      expect(cnc.host.textContent).not.toContain('power');
    } finally {
      useStore.setState({ project });
    }
  });

  it('never retries a zero-path colour trace: relaxing would repeat the same trace', () => {
    // Its 12 px speck default would make the shared predicate true, but a
    // missing despeckle reads as the same default in the colour backend.
    expect(colourPreset.despeckleMinPixels).toBeGreaterThan(1);
    expect(hasAggressivePreprocessing(colourPreset)).toBe(false);
    expect(hasAggressivePreprocessing(lineArtPreset)).toBe(true);
  });
});

async function mountColourControls(previewColours?: ReadonlyArray<string>) {
  let settings: LightBurnTraceSettingOverrides = {};
  function Harness() {
    const [overrides, set] = useState<LightBurnTraceSettingOverrides>({});
    const [preset] = useState<TraceOptions>(colourPreset);
    settings = overrides;
    return (
      <TraceSettingsControls
        preset={preset}
        overrides={overrides}
        onChange={set}
        previewColours={previewColours}
      />
    );
  }
  const host = await mountControl(<Harness />);
  const find = <T extends Element>(label: string, type: new () => T): T => {
    const element = host.querySelector(`[aria-label="${label}"]`);
    if (!(element instanceof type)) throw new Error(`Missing colour-layer control ${label}`);
    return element;
  };
  const select = (label: string): HTMLSelectElement =>
    find(`Trace ${label.toLowerCase()}`, HTMLSelectElement);
  return {
    host,
    settings: () => settings,
    select,
    input: (label: string): HTMLInputElement => find(label, HTMLInputElement),
    choose: async (label: string, value: string): Promise<void> => {
      await act(async () => {
        const element = select(label);
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    click: async (label: string): Promise<void> => {
      await act(async () => find(label, HTMLInputElement).click());
    },
  };
}
