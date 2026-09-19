import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type RawImageData, type TraceOptions } from '../../core/trace';
import {
  flattenStrengthFromSmoothness,
  optimizationToleranceScaleFromOptimize,
} from '../../core/trace/contour-trace';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { TraceSettingsControls } from './TraceSettingsControls';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('trace controls describe the options the engine actually receives', () => {
  it('makes Otsu-to-manual and back deliberate while retaining preset output', async () => {
    const image = paper(240);
    fill(image, 20, 15, 30, 30, [170, 170, 170]);
    await withControls('Smooth', async (controls) => {
      expect(controls.host.querySelector('[aria-label="Trace Threshold"]')).toBeNull();
      expect(controls.host.textContent).toContain('Automatic threshold (Otsu)');
      expect(controls.options()).toEqual(TRACE_PRESETS['Smooth']);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(900);

      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('128');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(0);
      await controls.change('Threshold', 190);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(900);

      await controls.detect('preset');
      expect(controls.host.querySelector('[aria-label="Trace Threshold"]')).toBeNull();
      expect(controls.options()).toEqual(TRACE_PRESETS['Smooth']);
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('190');
    });
  });

  it('identifies automatic pale-detail detection instead of showing an authoritative 128', async () => {
    const image = paper();
    fill(image, 20, 20, 30, 10, [220, 180, 80]);
    await withControls('Line Art', async (controls) => {
      expect(controls.host.querySelector('[aria-label="Trace Threshold"]')).toBeNull();
      expect(controls.host.textContent).toContain('Automatic (preserve pale details)');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(300);
      await controls.detect('manual');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(0);
      await controls.detect('preset');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(300);
    });
  });

  it('shows Sharp contour area 0 separately from speck area 1 and applies contour edits to holes', async () => {
    const image = paper();
    fill(image, 10, 10, 40, 35, [0, 0, 0]);
    fill(image, 30, 25, 1, 1, [255, 255, 255]);
    await withControls('Sharp', async (controls) => {
      expect(controls.number('Ignore Less Than').value).toBe('0');
      expect(controls.number('Remove ink specks').value).toBe('1');
      expect(await loopCount(image, controls.options())).toBe(2);
      await controls.change('Ignore Less Than', 4);
      expect(await loopCount(image, controls.options())).toBe(1);
      expect(controls.options().despeckleMinPixels).toBe(1);
    });
  });

  it('exposes the ink filter that removes a six-pixel detail without coupling contour edits', async () => {
    const image = paper();
    fill(image, 10, 10, 20, 20, [0, 0, 0]);
    fill(image, 60, 40, 3, 2, [0, 0, 0]);
    await withControls('Line Art', async (controls) => {
      expect(controls.number('Ignore Less Than').value).toBe('2');
      expect(controls.number('Remove ink specks').value).toBe('12');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(400);
      await controls.change('Ignore Less Than', 3);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(400);
      await controls.change('Remove ink specks', 2);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(406);
      expect(controls.options().ignoreLessThanPixels).toBe(3);
    });
  });

  it('hides the brightness band in explicit sketch mode and returns to manual values', async () => {
    await withControls('Sharp', async (controls) => {
      await controls.detect('manual');
      await controls.change('Threshold', 160);
      await controls.detect('sketch');
      expect(controls.host.querySelector('[aria-label="Trace Threshold"]')).toBeNull();
      expect(controls.options().sketchTrace).toBe(true);
      expect(controls.host.textContent).toContain('a brightness band is not used');
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('160');
      expect(controls.options().sketchTrace).toBe(false);
    });
  });

  it('uses the displayed alpha band and restores preset detection without stale manual values', async () => {
    const image = paper();
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
    fill(image, 20, 15, 30, 30, [170, 170, 170]);
    fill(image, 58, 15, 10, 30, [212, 212, 212]);
    for (let y = 15; y < 45; y += 1) {
      for (let x = 58; x < 68; x += 1) image.data[(y * image.width + x) * 4 + 3] = 128;
    }
    await withControls(
      'Sharp',
      async (controls) => {
        const toggleAlpha = async (): Promise<void> => {
          await act(async () => {
            const checkbox = controls.host.querySelector('input[type="checkbox"]');
            if (!(checkbox instanceof HTMLInputElement)) throw new Error('Missing alpha checkbox');
            checkbox.click();
          });
        };
        await toggleAlpha();
        expect(controls.host.querySelector('[aria-label="Trace detection"]')).toBeNull();
        expect(controls.host.textContent).toContain('Tracing transparency');
        expect(controls.number('Threshold').value).toBe('128');
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(1200);
        await controls.change('Threshold', 64);
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(900);
        await toggleAlpha();
        expect(controls.number('Threshold').value).toBe('64');
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(0);
        await controls.detect('preset');
        await toggleAlpha();
        expect(controls.number('Threshold').value).toBe('128');
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(1200);
      },
      true,
    );
  });
  it('keeps Edge finishing overrides visible and editable across preset changes and reset', async () => {
    await withControls('Smooth', async (controls) => {
      await controls.change('Smoothness', 0.73);
      await controls.change('Optimize', 0.41);
      await controls.selectPreset('Edge Detection');
      expect(controls.number('Smoothness').value).toBe('0.73');
      expect(controls.number('Optimize').value).toBe('0.41');
      await controls.change('Smoothness', 0.84);
      await controls.change('Optimize', 0.31);
      expect(controls.options()).toEqual({
        ...TRACE_PRESETS['Edge Detection'],
        smoothness: 0.84,
        optimize: 0.31,
      });
      await controls.selectPreset('Smooth');
      expect(controls.number('Smoothness').value).toBe('0.84');
      expect(controls.number('Optimize').value).toBe('0.31');
      await controls.selectPreset('Edge Detection');
      await controls.reset();
      expect(controls.options()).toEqual(TRACE_PRESETS['Edge Detection']);
      expect(controls.number('Smoothness').value).toBe('1');
      expect(controls.number('Optimize').value).toBe('0.2');
    });
  });

  it('shows Edge finishing defaults equivalent to the engine when options are omitted', async () => {
    await withControls('Edge Detection', async (controls) => {
      const options = controls.options();
      expect(options.smoothness).toBeUndefined();
      expect(options.optimize).toBeUndefined();
      expect(flattenStrengthFromSmoothness(Number(controls.number('Smoothness').value))).toBe(
        flattenStrengthFromSmoothness(options.smoothness),
      );
      expect(
        optimizationToleranceScaleFromOptimize(Number(controls.number('Optimize').value)),
      ).toBe(optimizationToleranceScaleFromOptimize(options.optimize));
      expect(controls.options()).toEqual(options);
    });
  });
});

type Controls = {
  readonly host: HTMLDivElement;
  readonly options: () => TraceOptions;
  readonly number: (label: string) => HTMLInputElement;
  readonly change: (label: string, value: number) => Promise<void>;
  readonly detect: (mode: string) => Promise<void>;
  readonly selectPreset: (name: string) => Promise<void>;
  readonly reset: () => Promise<void>;
};

async function withControls(
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
  const render = (): void =>
    root.render(
      <TraceSettingsControls
        preset={preset}
        overrides={settings}
        sourceHasTransparency={sourceHasTransparency}
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
      number,
      selectPreset: async (nextName) => {
        const next = TRACE_PRESETS[nextName];
        if (next === undefined) throw new Error(`Missing preset ${nextName}`);
        preset = next;
        await act(async () => render());
      },
      reset: async () => {
        const button = [...host.querySelectorAll('button')].find(
          (node) => node.textContent === 'Reset trace settings',
        );
        if (button === undefined) throw new Error('Missing reset button');
        await act(async () => button.click());
      },
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
      detect: async (mode) => {
        await act(async () => {
          const select = host.querySelector('[aria-label="Trace detection"]');
          if (!(select instanceof HTMLSelectElement)) throw new Error('Missing detection selector');
          select.value = mode;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
      },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

function paper(gray = 255): RawImageData {
  const data = new Uint8ClampedArray(80 * 60 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([gray, gray, gray, 255], i);
  return { width: 80, height: 60, data };
}

function fill(
  image: RawImageData,
  x0: number,
  y0: number,
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      image.data.set([...rgb, 255], (y * image.width + x) * 4);
    }
  }
}

function ink(image: RawImageData): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i] === 0) count += 1;
  return count;
}

async function loopCount(image: RawImageData, options: TraceOptions): Promise<number> {
  const paths = await traceImageToColoredPaths(image, options);
  return paths.reduce((count, path) => count + path.polylines.length, 0);
}
