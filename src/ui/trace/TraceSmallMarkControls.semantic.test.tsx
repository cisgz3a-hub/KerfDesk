// ADR-434 Amendment 1: the small-mark controls say what the engine does.
// Auto hands a stage to the automatic policy; a typed value is exact; the
// choice survives Re-trace (ADR-408); a preset switch drops overrides of what
// the new preset defines.
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { AUTO_CANDIDATE_AREA_PX } from '../../core/trace/small-mark-policy';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { fill, ink, paper } from './trace-controls-test-helpers';
import { mergeLightBurnTraceSettings } from './trace-options';
import { overridesForPresetSwitch } from './trace-preset-switch';
import { withControls, type Controls } from './trace-settings-controls.test-support';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';

const GRID = { width: 80, height: 60 };

function preset(name: string) {
  const options = TRACE_PRESETS[name];
  if (options === undefined) throw new Error(`Missing preset ${name}`);
  return options;
}

function checkbox(controls: Controls, label: string): HTMLInputElement {
  const input = controls.host.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing checkbox ${label}`);
  return input;
}

// A 20x20 block and a lone 6 px speck: Auto removes the speck, 0 keeps it.
function blockAndSpeck() {
  const image = paper();
  fill(image, 10, 10, 20, 20, [0, 0, 0]);
  fill(image, 60, 40, 3, 2, [0, 0, 0]);
  return image;
}

// A solid block with a 1x20 white slit: explicit On fills it, Off keeps it.
function blockWithSlit() {
  const image = paper();
  fill(image, 10, 10, 40, 35, [0, 0, 0]);
  fill(image, 25, 15, 1, 20, [255, 255, 255]);
  return image;
}

describe('small-mark controls show Auto or the exact value the engine uses', () => {
  it.each(['Line Art', 'Smooth'])('%s opens on Auto for both stages', async (name) => {
    await withControls(name, async (controls) => {
      const specks = controls.number('Remove ink specks');
      expect(specks.value).toBe('');
      expect(specks.disabled).toBe(true);
      expect(specks.placeholder).toBe('Auto');
      expect(checkbox(controls, 'Remove ink specks: Auto').checked).toBe(true);
      const holes = checkbox(controls, 'Fill tiny holes');
      expect(holes.indeterminate).toBe(true);
      expect(holes.disabled).toBe(true);
      expect(holes.checked).toBe(false);
      expect(checkbox(controls, 'Fill tiny holes: Auto').checked).toBe(true);
      expect(controls.options()).toEqual(preset(name));
      expect(controls.options().smallMarkPolicy).toBe('auto');
    });
  });

  it('a typed 0 is exact and keeps the speck Auto removes; Auto again restores the preset', async () => {
    const image = blockAndSpeck();
    await withControls('Line Art', async (controls) => {
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(400);
      await controls.check('Remove ink specks: Auto', false);
      expect(controls.number('Remove ink specks').value).toBe(String(AUTO_CANDIDATE_AREA_PX));
      expect(controls.options().despeckleMinPixels).toBe(AUTO_CANDIDATE_AREA_PX);
      await controls.change('Remove ink specks', 0);
      expect(controls.number('Remove ink specks').value).toBe('0');
      expect(controls.options().despeckleMinPixels).toBe(0);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(406);
      // The holes stage stays automatic while ink is exact.
      expect(checkbox(controls, 'Fill tiny holes: Auto').checked).toBe(true);
      expect(controls.options().smallMarkPolicy).toBe('auto');
      await controls.check('Remove ink specks: Auto', true);
      expect(controls.overrides()).toEqual({});
      expect(controls.options()).toEqual(preset('Line Art'));
    });
  });

  it('Fill tiny holes cycles Auto, Off and On with the engine following', async () => {
    const image = blockWithSlit();
    await withControls('Line Art', async (controls) => {
      await controls.check('Fill tiny holes: Auto', false);
      const holes = checkbox(controls, 'Fill tiny holes');
      expect(holes.indeterminate).toBe(false);
      expect(holes.disabled).toBe(false);
      expect(controls.options().fillPinholeCracks).toBe(false);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(1380);
      await controls.check('Fill tiny holes', true);
      expect(controls.options().fillPinholeCracks).toBe(true);
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(1400);
      await controls.check('Fill tiny holes: Auto', true);
      expect(controls.options()).toEqual(preset('Line Art'));
    });
  });

  it('offers Auto on a preset with fixed cleanup and keeps the other stage exact', async () => {
    await withControls('Centerline', async (controls) => {
      expect(controls.number('Remove ink specks').value).toBe('12');
      expect(checkbox(controls, 'Remove ink specks: Auto').checked).toBe(false);
      expect(checkbox(controls, 'Fill tiny holes').checked).toBe(true);
      expect(checkbox(controls, 'Fill tiny holes: Auto').checked).toBe(false);
      await controls.check('Remove ink specks: Auto', true);
      expect(controls.overrides()).toEqual({ despeckleMinPixels: 'auto' });
      const options = controls.options();
      expect(options.despeckleMinPixels).toBeUndefined();
      expect(options.smallMarkPolicy).toBe('auto');
      expect(options.fillPinholeCracks).toBe(true);
      await controls.check('Fill tiny holes: Auto', true);
      expect(controls.options().fillPinholeCracks).toBeUndefined();
    });
  });
});

describe('preset switch drops overrides the new preset defines (ADR-434 Amendment 1)', () => {
  it('resets small-mark choices into a preset that makes its own', () => {
    const fromCenterline = { despeckleMinPixels: 3, fillPinholeCracks: false } as const;
    expect(
      overridesForPresetSwitch(fromCenterline, preset('Centerline'), preset('Line Art')),
    ).toEqual({});
    // Sharp sets an ink area but no hole rule: only the ink override goes.
    expect(overridesForPresetSwitch(fromCenterline, preset('Line Art'), preset('Sharp'))).toEqual({
      fillPinholeCracks: false,
    });
    // Colour layers' Remove specks shares the key with its own meaning.
    expect(
      overridesForPresetSwitch(
        { despeckleMinPixels: 'auto' },
        preset('Line Art'),
        preset('Colour layers'),
      ),
    ).toEqual({});
  });

  it('never carries Smoothness or Optimize across the Centerline role boundary', () => {
    const tuned = { smoothness: 0.3, optimize: 1.5 };
    expect(overridesForPresetSwitch(tuned, preset('Smooth'), preset('Centerline'))).toEqual({});
    expect(overridesForPresetSwitch(tuned, preset('Centerline'), preset('Smooth'))).toEqual({});
    // Contour to contour: Smooth and Edge Detection set neither, so it carries.
    expect(overridesForPresetSwitch(tuned, preset('Smooth'), preset('Edge Detection'))).toBe(tuned);
    // Sharp calibrates its own finishing.
    expect(overridesForPresetSwitch(tuned, preset('Smooth'), preset('Sharp'))).toEqual({});
  });

  it('carries detection, Invert, alpha mask and style-exclusive controls', () => {
    const overrides = {
      detectionMode: 'manual',
      thresholdLuma: 150,
      invert: true,
      traceTransparency: true,
      photoDetail: 80,
      edgeMinimumLinePx: 5,
      colourCount: 4,
    } as const;
    for (const [from, to] of [
      ['Line Art', 'Sharp'],
      ['Sharp', 'Photo shading'],
      ['Photo shading', 'Line Art'],
      ['Line Art', 'Colour layers'],
    ] as const) {
      expect(overridesForPresetSwitch(overrides, preset(from), preset(to))).toBe(overrides);
    }
  });

  it('shows the new preset value in the controls after the switch', async () => {
    await withControls('Sharp', async (controls) => {
      await controls.change('Smoothness', 0.9);
      await controls.change('Remove ink specks', 40);
      await controls.selectPreset('Centerline');
      expect(controls.number('Smoothness').value).not.toBe('0.9');
      expect(controls.number('Remove ink specks').value).toBe('12');
      await controls.selectPreset('Line Art');
      expect(checkbox(controls, 'Remove ink specks: Auto').checked).toBe(true);
      expect(controls.options()).toEqual(preset('Line Art'));
    });
  });
});

describe('Re-trace keeps Auto and explicit small-mark choices (ADR-408)', () => {
  const record = (overrides: Record<string, number | boolean | string>) =>
    captureTraceSettings({
      presetName: 'Centerline',
      overrides,
      output: 'vector',
      fillStyle: 'scanline',
      boundary: null,
      boundaryMode: 'crop',
    });

  it('round-trips Auto and exact values to the same engine options', () => {
    for (const overrides of [
      { despeckleMinPixels: 'auto', fillPinholeCracks: 'auto' },
      { despeckleMinPixels: 0, fillPinholeCracks: false },
      { despeckleMinPixels: 'auto', fillPinholeCracks: true },
    ]) {
      const saved = JSON.parse(JSON.stringify(record(overrides))) as ReturnType<typeof record>;
      const restored = restoreTraceSettings(saved, GRID);
      expect(restored.overrides).toEqual(overrides);
      expect(mergeLightBurnTraceSettings(preset('Centerline'), restored.overrides ?? {})).toEqual(
        mergeLightBurnTraceSettings(preset('Centerline'), overrides as never),
      );
    }
  });

  it('loads records saved before Auto as the exact values they held', () => {
    const old = {
      schemaVersion: 1 as const,
      presetName: 'Line Art',
      overrides: { despeckleMinPixels: 0, fillPinholeCracks: false, smoothness: 0.5 },
    };
    const restored = restoreTraceSettings(old, GRID);
    expect(restored.presetName).toBe('Line Art');
    expect(restored.overrides).toEqual(old.overrides);
    const options = mergeLightBurnTraceSettings(preset('Line Art'), restored.overrides ?? {});
    expect(options.despeckleMinPixels).toBe(0);
    expect(options.fillPinholeCracks).toBe(false);
  });

  it('accepts Auto only where the control offers it', () => {
    const restored = restoreTraceSettings(
      {
        schemaVersion: 1,
        presetName: 'Line Art',
        overrides: {
          despeckleMinPixels: 'automatic',
          smoothness: 'auto',
          fillPinholeCracks: 'auto',
        },
      },
      GRID,
    );
    expect(restored.overrides).toEqual({ fillPinholeCracks: 'auto' });
  });
});
