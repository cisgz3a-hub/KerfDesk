import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluatePhotoToneCurve, isPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { captureLayerOperationSettings, LAYER_DEFAULTS } from '../../core/scene';
import { LAST_TONE_WEDGE_KEY, writeLastToneWedge } from './tone-calibration-draft';
import { ToneCalibrationDialog } from './ToneCalibrationDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = {
  sourceName: 'portrait.png',
  settings: {
    ...captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'image' }),
    ditherAlgorithm: 'stucki' as const,
    linesPerMm: 8.4666,
    power: 42,
    speed: 2400,
    negativeImage: true,
    dotWidthCorrectionMm: 0.03,
  },
};

async function render(step: 'generate' | 'record'): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
  readonly onSave: ReturnType<typeof vi.fn>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onGenerate = vi.fn();
  const onSave = vi.fn();
  await act(async () => {
    root.render(
      <ToneCalibrationDialog
        initialStep={step}
        seed={SEED}
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onSave={onSave}
      />,
    );
  });
  return { host, root, onGenerate, onSave };
}

function submit(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  localStorage.removeItem(LAST_TONE_WEDGE_KEY);
  document.body.innerHTML = '';
});

describe('ToneCalibrationDialog', () => {
  it("generates a wedge with the photo's whole operation and its exact interval", async () => {
    const { host, root, onGenerate } = await render('generate');
    try {
      expect(host.textContent).toContain('Settings from portrait.png');
      await act(async () => submit(host, 'Generate wedge'));
      const [options, target] = onGenerate.mock.calls[0] ?? [];
      expect(options.operation).toMatchObject({
        mode: 'image',
        ditherAlgorithm: 'stucki',
        linesPerMm: 8.4666,
        power: 42,
        speed: 2400,
        negativeImage: true,
        dotWidthCorrectionMm: 0.03,
        passThrough: false,
      });
      expect(options.patchCount).toBe(11);
      expect(target).toEqual({
        patchCount: 11,
        settings: {
          ditherAlgorithm: 'stucki',
          linesPerMm: 8.4666,
          power: 42,
          speed: 2400,
          negativeImage: true,
        },
      });
    } finally {
      act(() => root.unmount());
    }
  });

  it('records the burned wedge and saves a fitted, labelled curve', async () => {
    writeLastToneWedge({
      patchCount: 6,
      settings: {
        ditherAlgorithm: 'jarvis',
        linesPerMm: 10,
        power: 30,
        speed: 3000,
        negativeImage: false,
      },
    });
    const { host, root, onSave } = await render('record');
    try {
      const sliders = [...host.querySelectorAll('input[type="range"]')];
      expect(sliders).toHaveLength(4);
      expect(host.textContent).toContain('Wedge of 6 patches burned with Jarvis · 254 DPI');
      await act(async () => submit(host, 'Save calibration'));
      expect(onSave).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Name the material');
      await act(async () => {
        for (const slider of sliders) {
          if (!(slider instanceof HTMLInputElement)) continue;
          slider.value = String(Math.min(100, Number(slider.value) + 25));
          Simulate.change(slider);
        }
        const material = host.querySelector('input[aria-label="Calibrated material"]');
        if (!(material instanceof HTMLInputElement)) throw new Error('Material missing');
        material.value = 'Birch ply';
        Simulate.change(material);
      });
      await act(async () => submit(host, 'Save calibration'));
      const record = onSave.mock.calls[0]?.[0];
      expect(record.curve.label).toBe(
        'Birch ply · Jarvis · 254 DPI · 30% · 3000 mm/min · dark marks',
      );
      expect(isPhotoToneCurve(record.curve)).toBe(true);
      expect(record.samples).toHaveLength(6);
      // Darker than asked everywhere, so a midtone asks for fewer dots.
      expect(evaluatePhotoToneCurve(record.curve, 128)).toBeGreaterThan(150);
    } finally {
      act(() => root.unmount());
    }
  });
});
