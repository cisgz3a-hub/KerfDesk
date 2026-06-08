import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type RasterImage } from '../../core/scene';
import { AdjustImageDialog } from './AdjustImageDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const image: RasterImage = {
  kind: 'raster-image',
  id: 'image-1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 2,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, mirrorX: false, mirrorY: false },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  lumaBase64: 'AP8=',
  brightness: 0,
  contrast: 0,
  gamma: 1,
};

const layer = {
  ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
  power: 40,
  minPower: 5,
  linesPerMm: 10,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AdjustImageDialog', () => {
  it('stages image and layer changes until OK', async () => {
    const onApply = vi.fn();
    const { host, root } = await renderDialog({ onApply });
    try {
      change(host, 'input[name="brightness"]', '25');
      change(host, 'input[name="contrast"]', '-10');
      change(host, 'input[name="gamma"]', '1.4');
      change(host, 'select[name="ditherAlgorithm"]', 'grayscale');
      change(host, 'input[name="minPower"]', '12');
      change(host, 'input[name="linesPerMm"]', '12');
      change(host, 'input[name="dotWidthCorrectionMm"]', '0.05');
      click(host, 'input[name="negativeImage"]');
      click(host, 'input[name="passThrough"]');

      expect(onApply).not.toHaveBeenCalled();

      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      expect(onApply).toHaveBeenCalledWith({
        imagePatch: { brightness: 25, contrast: -10, gamma: 1.4 },
        layerPatch: {
          ditherAlgorithm: 'grayscale',
          minPower: 12,
          linesPerMm: 12,
          dotWidthCorrectionMm: 0.05,
          negativeImage: true,
          passThrough: true,
        },
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('discards staged changes on Cancel and exposes source and processed previews', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const { host, root } = await renderDialog({ onApply, onCancel });
    try {
      expect(host.querySelector('canvas[aria-label="Source image preview"]')).not.toBeNull();
      expect(host.querySelector('canvas[aria-label="Processed image preview"]')).not.toBeNull();

      change(host, 'input[name="brightness"]', '55');
      await act(async () => {
        const cancel = [...host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Cancel',
        );
        if (!(cancel instanceof HTMLButtonElement)) throw new Error('cancel missing');
        Simulate.click(cancel);
      });

      expect(onCancel).toHaveBeenCalled();
      expect(onApply).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('labels preview inversion separately from burn negative output', async () => {
    const onApply = vi.fn();
    const { host, root } = await renderDialog({ onApply });
    try {
      const text = host.textContent ?? '';
      expect(text).toContain('Negative Image');
      expect(text).toContain('Invert Preview');
      expect(text).not.toContain('Invert display');

      click(host, 'input[name="invertDisplay"]');

      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      const patch = onApply.mock.calls[0]?.[0];
      expect(patch?.layerPatch).toHaveProperty('negativeImage', false);
      expect(patch?.layerPatch).not.toHaveProperty('invertDisplay');
      expect(patch?.imagePatch).not.toHaveProperty('invertDisplay');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('applies built-in presets to the local draft before OK', async () => {
    const onApply = vi.fn();
    const { host, root } = await renderDialog({ onApply });
    try {
      change(host, 'input[name="brightness"]', '25');
      click(host, 'input[name="negativeImage"]');
      click(host, 'input[name="invertDisplay"]');

      change(host, 'select[name="imagePreset"]', 'basic');

      expect((host.querySelector('input[name="brightness"]') as HTMLInputElement).value).toBe('0');
      expect((host.querySelector('input[name="negativeImage"]') as HTMLInputElement).checked).toBe(
        false,
      );
      expect((host.querySelector('input[name="invertDisplay"]') as HTMLInputElement).checked).toBe(
        false,
      );

      change(host, 'select[name="imagePreset"]', 'black-paint-on-white');

      expect((host.querySelector('input[name="negativeImage"]') as HTMLInputElement).checked).toBe(
        true,
      );
      expect((host.querySelector('input[name="invertDisplay"]') as HTMLInputElement).checked).toBe(
        true,
      );
      expect(onApply).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('saves, reapplies, and deletes user presets without applying to the scene', async () => {
    const onApply = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('Wood logo');
    const { host, root } = await renderDialog({ onApply });
    try {
      change(host, 'input[name="brightness"]', '33');
      change(host, 'input[name="contrast"]', '-12');
      change(host, 'input[name="gamma"]', '1.8');
      change(host, 'select[name="ditherAlgorithm"]', 'jarvis');
      change(host, 'input[name="minPower"]', '9');
      change(host, 'input[name="linesPerMm"]', '15');
      change(host, 'input[name="dotWidthCorrectionMm"]', '0.02');
      click(host, 'input[name="negativeImage"]');
      click(host, 'input[name="passThrough"]');
      click(host, 'input[name="invertDisplay"]');

      clickButton(host, 'button[name="saveImagePreset"]');

      expect(host.querySelector('option[value="user:Wood logo"]')).not.toBeNull();

      change(host, 'input[name="brightness"]', '0');
      change(host, 'input[name="contrast"]', '0');
      change(host, 'input[name="gamma"]', '1');
      change(host, 'select[name="ditherAlgorithm"]', 'threshold');
      change(host, 'input[name="minPower"]', '0');
      change(host, 'input[name="linesPerMm"]', '10');
      change(host, 'input[name="dotWidthCorrectionMm"]', '0');
      click(host, 'input[name="negativeImage"]');
      click(host, 'input[name="passThrough"]');
      click(host, 'input[name="invertDisplay"]');

      change(host, 'select[name="imagePreset"]', 'user:Wood logo');

      expect((host.querySelector('input[name="brightness"]') as HTMLInputElement).value).toBe('33');
      expect((host.querySelector('input[name="contrast"]') as HTMLInputElement).value).toBe('-12');
      expect((host.querySelector('input[name="gamma"]') as HTMLInputElement).value).toBe('1.8');
      expect(
        (host.querySelector('select[name="ditherAlgorithm"]') as HTMLSelectElement).value,
      ).toBe('jarvis');
      expect((host.querySelector('input[name="minPower"]') as HTMLInputElement).value).toBe('9');
      expect((host.querySelector('input[name="linesPerMm"]') as HTMLInputElement).value).toBe('15');
      expect(
        (host.querySelector('input[name="dotWidthCorrectionMm"]') as HTMLInputElement).value,
      ).toBe('0.02');
      expect((host.querySelector('input[name="negativeImage"]') as HTMLInputElement).checked).toBe(
        true,
      );
      expect((host.querySelector('input[name="passThrough"]') as HTMLInputElement).checked).toBe(
        true,
      );
      expect((host.querySelector('input[name="invertDisplay"]') as HTMLInputElement).checked).toBe(
        true,
      );

      clickButton(host, 'button[name="deleteImagePreset"]');

      expect(host.querySelector('option[value="user:Wood logo"]')).toBeNull();
      expect((host.querySelector('select[name="imagePreset"]') as HTMLSelectElement).value).toBe(
        'custom',
      );
      expect(onApply).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function renderDialog(opts: {
  readonly onApply?: Parameters<typeof AdjustImageDialog>[0]['onApply'];
  readonly onCancel?: () => void;
}): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <AdjustImageDialog
        image={image}
        layer={layer}
        onApply={opts.onApply ?? vi.fn()}
        onCancel={opts.onCancel ?? vi.fn()}
      />,
    );
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

function change(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) {
    throw new Error(`${selector} missing`);
  }
  act(() => {
    input.value = value;
    Simulate.change(input);
  });
}

function click(host: HTMLElement, selector: string): void {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} missing`);
  act(() => {
    input.checked = !input.checked;
    Simulate.change(input);
  });
}

function clickButton(host: HTMLElement, selector: string): void {
  const button = host.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${selector} missing`);
  act(() => {
    Simulate.click(button);
  });
}
