import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

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
});

async function renderPreview(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(TracePreview, { state: readyState, sourceDataUrl: SOURCE_DATA_URL }));
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
