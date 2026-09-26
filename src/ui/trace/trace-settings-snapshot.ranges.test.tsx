// ADR-408: restored numeric settings are fitted to the range each dialog
// control offers. The ranges live beside the persistence rules, so this test
// renders the real controls and fails when a control's range and its
// persistence rule drift apart, in either direction.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { TraceSettingsControls } from './TraceSettingsControls';
import type { LightBurnTraceSettingOverrides } from './trace-options';
import { TRACE_OVERRIDE_RULES } from './trace-settings-snapshot';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RuleKey = keyof typeof TRACE_OVERRIDE_RULES;

// Each rendered number control, by its visible label, per control family.
const FAMILIES: ReadonlyArray<{
  readonly preset: string;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly labels: Readonly<Record<string, RuleKey>>;
}> = [
  {
    preset: 'Line Art',
    // Manual detection shows the Cutoff and Threshold band.
    overrides: { detectionMode: 'manual' },
    labels: {
      Cutoff: 'cutoffLuma',
      Threshold: 'thresholdLuma',
      'Remove ink specks': 'despeckleMinPixels',
      'Ignore Less Than': 'ignoreLessThanPixels',
      Smoothness: 'smoothness',
      Optimize: 'optimize',
    },
  },
  {
    preset: 'Edge Detection',
    overrides: {},
    labels: {
      Sensitivity: 'edgeSensitivity',
      Detail: 'edgeDetail',
      'Minimum line': 'edgeMinimumLinePx',
      Smoothness: 'smoothness',
      Optimize: 'optimize',
    },
  },
  {
    preset: 'Photo shading',
    overrides: {},
    labels: {
      Detail: 'photoDetail',
      Brightness: 'photoBrightness',
      Contrast: 'photoContrast',
      Midtones: 'photoGamma',
    },
  },
];

describe('persisted setting ranges match the dialog controls (ADR-408)', () => {
  it.each(FAMILIES)('$preset number controls use the persisted ranges', async (family) => {
    const preset = TRACE_PRESETS[family.preset];
    expect(preset).toBeDefined();
    if (preset === undefined) return;
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(TraceSettingsControls, {
          preset,
          overrides: family.overrides,
          sourceHasTransparency: false,
          onChange: () => undefined,
        }),
      );
    });
    try {
      const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="number"]'));
      const rendered = inputs.map((input) => {
        const label = (input.getAttribute('aria-label') ?? '').replace(/^Trace /, '');
        return { label, min: Number(input.min), max: Number(input.max) };
      });
      expect(rendered.map((row) => row.label).sort()).toEqual(Object.keys(family.labels).sort());
      for (const row of rendered) {
        const key = family.labels[row.label];
        const rule = key === undefined ? undefined : TRACE_OVERRIDE_RULES[key];
        expect(rule, row.label).toMatchObject({ kind: 'number', min: row.min, max: row.max });
      }
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('covers every numeric persisted setting with a rendered control', () => {
    const covered = new Set(FAMILIES.flatMap((family) => Object.values(family.labels)));
    const numeric = (Object.keys(TRACE_OVERRIDE_RULES) as RuleKey[]).filter(
      (key) => TRACE_OVERRIDE_RULES[key].kind === 'number',
    );
    expect(numeric.filter((key) => !covered.has(key))).toEqual([]);
  });
});
