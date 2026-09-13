import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type RasterImage } from '../../core/scene';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import type * as BitmapModule from '../raster/vector-to-bitmap';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { ConvertBitmapDialogHost } from './ConvertBitmapDialogHost';

vi.mock('../raster/vector-to-bitmap', async (importOriginal) => ({
  ...(await importOriginal<typeof BitmapModule>()),
  buildBitmapFromVectors: vi.fn(),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  vi.mocked(buildBitmapFromVectors).mockReset();
});

async function renderHost() {
  const source = svgObj('vector', ['#000000']);
  const project = createProject();
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [source] } } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = vi.fn();
  await act(async () =>
    root.render(<ConvertBitmapDialogHost convertibles={[source]} onClose={close} />),
  );
  return {
    host,
    close,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!result) throw new Error(`${label} button missing`);
  return result;
}

describe('Convert Bitmap dialog lifecycle', () => {
  it('keeps progress visible, prevents duplicate submits, and lets Cancel stop work', async () => {
    vi.mocked(buildBitmapFromVectors).mockImplementation(
      (_objects, _options, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const ui = await renderHost();
    try {
      await act(async () => {
        const convert = button(ui.host, 'Convert');
        Simulate.click(convert);
        Simulate.click(convert);
      });
      expect(buildBitmapFromVectors).toHaveBeenCalledOnce();
      expect(ui.close).not.toHaveBeenCalled();
      expect(ui.host.querySelector('progress')).not.toBeNull();
      expect(button(ui.host, 'Converting…').disabled).toBe(true);
      expect(ui.host.querySelector('fieldset')?.disabled).toBe(true);
      await act(async () => Simulate.submit(ui.host.querySelector('form')!));
      expect(buildBitmapFromVectors).toHaveBeenCalledOnce();
      await act(async () => Simulate.click(button(ui.host, 'Cancel')));
      expect(vi.mocked(buildBitmapFromVectors).mock.calls[0]?.[2]?.aborted).toBe(true);
      expect(ui.close).toHaveBeenCalledOnce();
      expect(useStore.getState().project.scene.objects[0]?.kind).toBe('imported-svg');
    } finally {
      await ui.cleanup();
    }
  });

  it('retains settings after failure and allows retry', async () => {
    vi.mocked(buildBitmapFromVectors).mockRejectedValue(new Error('Encoding failed'));
    const ui = await renderHost();
    try {
      const dpi = ui.host.querySelector<HTMLInputElement>('input[name="dpi"]')!;
      await act(async () => {
        dpi.value = '300';
        Simulate.change(dpi);
      });
      await act(async () => Simulate.click(button(ui.host, 'Convert')));
      expect(ui.close).not.toHaveBeenCalled();
      expect(ui.host.textContent).toContain('Encoding failed');
      expect(dpi.value).toBe('300');
      expect(button(ui.host, 'Convert').disabled).toBe(false);
      await act(async () => Simulate.click(button(ui.host, 'Convert')));
      expect(buildBitmapFromVectors).toHaveBeenCalledTimes(2);
      expect(vi.mocked(buildBitmapFromVectors).mock.calls[1]?.[1]?.dpi).toBe(300);
    } finally {
      await ui.cleanup();
    }
  });

  it('aborts pending work when the host unmounts', async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(buildBitmapFromVectors).mockReturnValue(
      new Promise<RasterImage>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    const ui = await renderHost();
    await act(async () => Simulate.click(button(ui.host, 'Convert')));
    const signal = vi.mocked(buildBitmapFromVectors).mock.calls[0]?.[2];
    await ui.cleanup();
    expect(signal?.aborted).toBe(true);
    await act(async () => reject(new DOMException('Cancelled', 'AbortError')));
    expect(ui.close).not.toHaveBeenCalled();
  });
});
