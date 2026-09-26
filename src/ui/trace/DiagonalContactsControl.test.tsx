// ADR-450: the Trace dialog's Diagonal contacts control drives
// TraceOptions.turnPolicy (ADR-403). Rendered through the real
// TraceSettingsControls, traced through the real engine.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { TraceSettingsControls } from './TraceSettingsControls';
import { fill, loopCount, paper } from './trace-controls-test-helpers';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL = 'Trace diagonal contacts';

describe('Diagonal contacts control (ADR-450)', () => {
  it('is a labelled native select in Curve finishing with three described choices', async () => {
    await withControls('Line Art', async (view) => {
      const select = view.select();
      expect(select).not.toBeNull();
      if (select === null) return;
      expect(select.closest('details')?.querySelector('summary')?.textContent).toBe(
        'Curve finishing',
      );
      expect(select.closest('label')?.textContent).toContain('Diagonal contacts');
      expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
        ['auto', 'Auto'],
        ['connect-ink', 'Join ink'],
        ['connect-paper', 'Split ink'],
      ]);
      expect(select.value).toBe('auto');
      const hint = document.getElementById(select.getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent).toMatch(/touch only at a corner, like squares on a checkerboard/);
      for (const choice of ['Auto', 'Join ink', 'Split ink'])
        expect(hint?.textContent).toContain(choice);
      // Each forced choice names its cost, not only its benefit.
      expect(hint?.textContent).toMatch(
        /Join ink[^.]*diagonal gap in solid ink closes or breaks up/,
      );
      expect(hint?.textContent).toMatch(
        /Split ink[^.]*diagonal line can break into dots or disappear/,
      );
      // A native, enabled select: focusable and operable from the keyboard.
      expect(select.disabled).toBe(false);
      select.focus();
      expect(document.activeElement).toBe(select);
    });
  });

  it('is offered only where the filled-contour lane uses it', async () => {
    for (const name of ['Line Art', 'Smooth', 'Sharp']) {
      await withControls(name, async (view) => expect(view.select()).not.toBeNull());
    }
    for (const name of ['Centerline', 'Edge Detection', 'Photo shading', 'Colour layers']) {
      await withControls(name, async (view) => expect(view.select()).toBeNull());
    }
  });

  it('reaches the engine and changes a corner-contact trace', async () => {
    // Two squares touching only at one corner: Auto (a tie on binary art)
    // and Split ink keep two outlines; Join ink traces one.
    const image = paper();
    fill(image, 10, 10, 20, 20, [0, 0, 0]);
    fill(image, 30, 30, 20, 20, [0, 0, 0]);
    await withControls('Line Art', async (view) => {
      expect(view.options().turnPolicy).toBeUndefined();
      expect(await loopCount(image, view.options())).toBe(2);
      await view.choose('connect-ink');
      expect(view.options().turnPolicy).toBe('connect-ink');
      expect(await loopCount(image, view.options())).toBe(1);
      await view.choose('connect-paper');
      expect(view.options().turnPolicy).toBe('connect-paper');
      expect(await loopCount(image, view.options())).toBe(2);
    });
  });

  it('keeps the choice across preset switches and clears it on reset', async () => {
    await withControls('Line Art', async (view) => {
      await view.choose('connect-ink');
      await view.selectPreset('Sharp');
      expect(view.select()?.value).toBe('connect-ink');
      expect(view.options().turnPolicy).toBe('connect-ink');
      await view.selectPreset('Centerline');
      expect(view.select()).toBeNull();
      await view.selectPreset('Smooth');
      expect(view.select()?.value).toBe('connect-ink');
      await view.reset();
      expect(view.select()?.value).toBe('auto');
      expect(view.overrides()).toEqual({});
      expect(view.options()).toEqual(TRACE_PRESETS['Smooth']);
    });
  });

  it('round-trips through the Re-trace record; records without it load as Auto', () => {
    const grid = { width: 100, height: 80 };
    const record = captureTraceSettings({
      presetName: 'Sharp',
      overrides: { turnPolicy: 'connect-paper' },
      output: 'vector',
      fillStyle: 'scanline',
      boundary: null,
      boundaryMode: 'crop',
    });
    expect(record.overrides).toEqual({ turnPolicy: 'connect-paper' });
    expect(restoreTraceSettings(record, grid).overrides).toEqual({ turnPolicy: 'connect-paper' });

    const older: TraceSettingsRecord = {
      schemaVersion: 1,
      presetName: 'Sharp',
      overrides: { smoothness: 0.5 },
    };
    const restored = restoreTraceSettings(older, grid);
    expect(restored.overrides).toEqual({ smoothness: 0.5 });
    const sharp = TRACE_PRESETS['Sharp'] as TraceOptions;
    expect(mergeLightBurnTraceSettings(sharp, restored.overrides ?? {}).turnPolicy).toBeUndefined();

    // A value this build does not offer (a hand edit, a later build) is dropped.
    const unknown = { ...older, overrides: { turnPolicy: 'majority' } };
    expect(restoreTraceSettings(unknown, grid).overrides).toEqual({});
  });
});

type View = {
  readonly select: () => HTMLSelectElement | null;
  readonly options: () => TraceOptions;
  readonly overrides: () => LightBurnTraceSettingOverrides;
  readonly choose: (value: string) => Promise<void>;
  readonly selectPreset: (name: string) => Promise<void>;
  readonly reset: () => Promise<void>;
};

async function withControls(name: string, run: (view: View) => Promise<void>): Promise<void> {
  let preset = presetNamed(name);
  let settings: LightBurnTraceSettingOverrides = {};
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (): void =>
    root.render(
      <TraceSettingsControls
        preset={preset}
        overrides={settings}
        sourceHasTransparency={false}
        onChange={(next) => {
          settings = next;
          render();
        }}
      />,
    );
  const select = (): HTMLSelectElement | null => host.querySelector(`[aria-label="${LABEL}"]`);
  await act(async () => render());
  try {
    await run({
      select,
      options: () => mergeLightBurnTraceSettings(preset, settings),
      overrides: () => settings,
      choose: async (value) => {
        const node = select();
        if (node === null) throw new Error('Missing Diagonal contacts');
        await act(async () => {
          node.value = value;
          node.dispatchEvent(new Event('change', { bubbles: true }));
        });
      },
      selectPreset: async (next) => {
        preset = presetNamed(next);
        await act(async () => render());
      },
      reset: async () => {
        const button = [...host.querySelectorAll('button')].find(
          (node) => node.textContent === 'Reset trace settings',
        );
        if (button === undefined) throw new Error('Missing reset button');
        await act(async () => button.click());
      },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

function presetNamed(name: string): TraceOptions {
  const preset = TRACE_PRESETS[name];
  if (preset === undefined) throw new Error(`Missing preset ${name}`);
  return preset;
}
