// The Trace settings controls rendered the way the dialog drives them:
// overrides held by the caller, and a preset switch applying the dialog's
// override reset (ADR-434 Amendment 1).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import type { TraceReport } from '../../core/trace/trace-steps';
import type { TraceGrid } from './trace-boundary-grid';
import { TraceSettingsControls } from './TraceSettingsControls';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { overridesForPresetSwitch } from './trace-preset-switch';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export type Controls = {
  readonly host: HTMLDivElement;
  readonly options: () => TraceOptions;
  readonly number: (label: string) => HTMLInputElement;
  readonly change: (label: string, value: number) => Promise<void>;
  readonly detect: (mode: string) => Promise<void>;
  readonly check: (label: string, checked: boolean) => Promise<void>;
  readonly selectPreset: (name: string) => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly overrides: () => LightBurnTraceSettingOverrides;
  /** What a matching finished preview found (the dialog's preview facts). */
  readonly setPreviewFacts: (facts: PreviewFacts) => Promise<void>;
};

type PreviewFacts = {
  readonly report?: TraceReport | undefined;
  readonly previewGrid?: TraceGrid | undefined;
};

export async function withControls(
  name: string,
  run: (controls: Controls) => Promise<void>,
  sourceHasTransparency = false,
): Promise<void> {
  const initialPreset = TRACE_PRESETS[name];
  if (initialPreset === undefined) throw new Error(`Missing preset ${name}`);
  let preset = initialPreset;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let settings: LightBurnTraceSettingOverrides = {};
  let facts: PreviewFacts = {};
  const render = (): void =>
    root.render(
      <TraceSettingsControls
        preset={preset}
        overrides={settings}
        sourceHasTransparency={sourceHasTransparency}
        report={facts.report}
        previewGrid={facts.previewGrid}
        onChange={(next) => {
          settings = next;
          render();
        }}
      />,
    );
  const number = (label: string): HTMLInputElement => {
    const input = host.querySelector(`[aria-label="Trace ${label}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing number ${label}`);
    return input;
  };
  await act(async () => render());
  try {
    await run({
      host,
      options: () => mergeLightBurnTraceSettings(preset, settings),
      overrides: () => settings,
      setPreviewFacts: async (next) => {
        facts = next;
        await act(async () => render());
      },
      number,
      check: async (label, checked) => {
        const input = host.querySelector(`[aria-label="${label}"]`);
        if (!(input instanceof HTMLInputElement)) throw new Error(`Missing checkbox ${label}`);
        if (input.checked !== checked) await act(async () => input.click());
      },
      selectPreset: async (nextName) => {
        const next = TRACE_PRESETS[nextName];
        if (next === undefined) throw new Error(`Missing preset ${nextName}`);
        settings = overridesForPresetSwitch(settings, preset, next);
        preset = next;
        await act(async () => render());
      },
      reset: () => clickButton(host, 'Reset trace settings'),
      change: async (label, value) => {
        await act(async () => {
          const input = number(label);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            String(value),
          );
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      },
      detect: (mode) => selectDetection(host, mode),
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

async function clickButton(host: HTMLElement, text: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent === text);
  if (button === undefined) throw new Error(`Missing button ${text}`);
  await act(async () => button.click());
}

async function selectDetection(host: HTMLElement, mode: string): Promise<void> {
  await act(async () => {
    const select = host.querySelector('[aria-label="Trace detection"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing detection selector');
    select.value = mode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
