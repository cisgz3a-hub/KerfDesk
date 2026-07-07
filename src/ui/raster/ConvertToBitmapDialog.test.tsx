import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type Bounds } from '../../core/scene';
import { ConvertToBitmapDialog } from './ConvertToBitmapDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const smallBounds: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const hugeBounds: Bounds = { minX: 0, minY: 0, maxX: 778.2, maxY: 505 };

describe('ConvertToBitmapDialog', () => {
  it('shows the estimated bitmap size and submits valid options', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      expect(host.textContent).toContain('100 x 100 px');

      change(host, 'select[name="renderType"]', 'outlines');
      change(host, 'input[name="dpi"]', '127');

      await submit(host);

      expect(onConvert).toHaveBeenCalledWith({
        renderType: 'outlines',
        dpi: 127,
        brightnessPercent: 50,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps a partially typed DPI instead of clamping every keystroke', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      // Typing "300" starts with "3" — below the DPI minimum. The field must
      // keep the raw text (clamping happens at submit), or typed entry is
      // impossible: every first digit would snap to the minimum.
      change(host, 'input[name="dpi"]', '3');
      const dpiInput = host.querySelector('input[name="dpi"]');
      expect(dpiInput instanceof HTMLInputElement && dpiInput.value).toBe('3');

      change(host, 'input[name="dpi"]', '300');
      await submit(host);

      expect(onConvert).toHaveBeenCalledWith({
        renderType: 'fill-all',
        dpi: 300,
        brightnessPercent: 50,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('clamps an out-of-range typed DPI at submit, not while typing', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      change(host, 'input[name="dpi"]', '9999');
      await submit(host);
      expect(onConvert).toHaveBeenCalledWith(
        expect.objectContaining({ dpi: 635 }), // MAX_CONVERT_TO_BITMAP_DPI
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('syncs the DPI slider into the numeric field and the submitted options', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      change(host, 'input[name="dpiSlider"]', '400');
      const dpiInput = host.querySelector('input[name="dpi"]');
      expect(dpiInput instanceof HTMLInputElement && dpiInput.value).toBe('400');

      await submit(host);
      expect(onConvert).toHaveBeenCalledWith(expect.objectContaining({ dpi: 400 }));
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('submits an adjusted Default Brightness', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      change(host, 'input[name="brightness"]', '70');
      await submit(host);
      expect(onConvert).toHaveBeenCalledWith(expect.objectContaining({ brightnessPercent: 70 }));
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('submits when the operator clicks Convert', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: smallBounds, onConvert });
    try {
      await act(async () => {
        Simulate.click(findButton(host, 'Convert'));
      });

      expect(onConvert).toHaveBeenCalledWith({
        renderType: 'fill-all',
        dpi: 254,
        brightnessPercent: 50,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('disables Convert when the requested DPI exceeds the raster budget', async () => {
    const onConvert = vi.fn();
    const { host, root } = await renderDialog({ bounds: hugeBounds, onConvert });
    try {
      expect(host.textContent).toContain('7782 x 5050 px');
      expect(host.textContent).toContain('exceeds the 4000000 px limit');

      const convert = findButton(host, 'Convert');
      expect(convert.disabled).toBe(true);

      await submit(host);
      expect(onConvert).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

async function renderDialog(opts: {
  readonly bounds: Bounds;
  readonly onConvert?: Parameters<typeof ConvertToBitmapDialog>[0]['onConvert'];
}): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <ConvertToBitmapDialog
        sourceName="logo.svg"
        bounds={opts.bounds}
        transform={IDENTITY_TRANSFORM}
        onCancel={vi.fn()}
        onConvert={opts.onConvert ?? vi.fn()}
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

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    const form = host.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
    Simulate.submit(form);
  });
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return button;
}
