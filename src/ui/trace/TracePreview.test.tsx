import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { TracePreview } from './TracePreview';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE_DATA_URL = 'data:image/png;base64,AAA';
const readyState: TracePreviewState = {
  kind: 'ready',
  svg: '<svg viewBox="0 0 2 2"><path id="trace-path" d="M0 0L2 2"/></svg>',
  width: 2,
  height: 2,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 2 },
          ],
        },
      ],
    },
  ],
};

describe('TracePreview source overlay controls', () => {
  it('shows the source bitmap and Fade Image toggle', async () => {
    const { host, root } = await renderPreview();
    try {
      expect(host.textContent).toContain('Fade Image');
      const image = host.querySelector('img[aria-label="Trace source image"]');
      expect(image).not.toBeNull();
      expect(image?.getAttribute('src')).toBe(SOURCE_DATA_URL);
    } finally {
      await cleanup(root, host);
    }
  });

  it('dims only the source image when Fade Image is toggled', async () => {
    const { host, root } = await renderPreview();
    try {
      const image = host.querySelector(
        'img[aria-label="Trace source image"]',
      ) as HTMLImageElement | null;
      expect(image).not.toBeNull();
      const opacityBefore = image?.style.opacity;
      const button = host.querySelector('button');
      expect(button).not.toBeNull();
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const imageAfter = host.querySelector('img[aria-label="Trace source image"]');
      expect((imageAfter as HTMLImageElement | null)?.style.opacity).not.toBe(opacityBefore);
      expect(host.querySelector('#trace-path')).not.toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('shows traced nodes when Show Points is toggled', async () => {
    const { host, root } = await renderPreview();
    try {
      expect(host.querySelector('[aria-label="Trace points"]')).toBeNull();
      const button = findButton(host, 'Show Points');
      expect(button).not.toBeNull();
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const points = host.querySelector('[aria-label="Trace points"]');
      expect(points).not.toBeNull();
      expect(points?.querySelectorAll('circle')).toHaveLength(2);
      expect(host.querySelector('#trace-path')).not.toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('reports a dragged Boundary rectangle in image pixels', async () => {
    const onBoundaryChange = vi.fn();
    const { host, root } = await renderPreview({
      imageSize: { width: 100, height: 100 },
      onBoundaryChange,
    });
    try {
      const frame = host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement | null;
      expect(frame).not.toBeNull();
      stubRect(frame!, { left: 0, top: 0, width: 100, height: 100 });
      await act(async () => {
        frame?.dispatchEvent(
          new MouseEvent('mousedown', { clientX: 10, clientY: 20, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 40, clientY: 60, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mouseup', { clientX: 40, clientY: 60, bubbles: true }),
        );
      });
      expect(onBoundaryChange).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 30, height: 40 });
    } finally {
      await cleanup(root, host);
    }
  });

  it('ignores Boundary drags while the preview frame is collapsed', async () => {
    const onBoundaryChange = vi.fn();
    const { host, root } = await renderPreview({
      imageSize: { width: 100, height: 100 },
      onBoundaryChange,
    });
    try {
      const frame = host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement | null;
      expect(frame).not.toBeNull();
      stubRect(frame!, { left: 0, top: 0, width: 0, height: 100 });
      await act(async () => {
        frame?.dispatchEvent(
          new MouseEvent('mousedown', { clientX: 10, clientY: 20, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 40, clientY: 60, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mouseup', { clientX: 40, clientY: 60, bubbles: true }),
        );
      });
      expect(onBoundaryChange).not.toHaveBeenCalled();
    } finally {
      await cleanup(root, host);
    }
  });

  it('clears the active Boundary rectangle', async () => {
    const onBoundaryClear = vi.fn();
    const { host, root } = await renderPreview({
      boundary: { x: 10, y: 20, width: 30, height: 40 },
      imageSize: { width: 100, height: 100 },
      onBoundaryClear,
    });
    try {
      const button = findButton(host, 'Clear Boundary');
      expect(button).not.toBeNull();
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onBoundaryClear).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(root, host);
    }
  });
});

async function renderPreview(
  overrides: Partial<React.ComponentProps<typeof TracePreview>> = {},
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      createElement(TracePreview, {
        state: readyState,
        sourceDataUrl: SOURCE_DATA_URL,
        ...overrides,
      }),
    );
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

async function cleanup(root: Root, host: HTMLDivElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === label) ??
    null
  );
}

function stubRect(
  element: HTMLElement,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => undefined,
    }) as DOMRect;
}
