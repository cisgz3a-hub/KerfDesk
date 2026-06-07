import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
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
