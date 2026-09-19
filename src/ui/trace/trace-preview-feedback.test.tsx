import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TracePreview } from './TracePreview';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PreviewProps = React.ComponentProps<typeof TracePreview>;
// Vitest stubs CSS imports. Install the actual stylesheet to exercise its
// selectors against fill-only contours, stroke-only paths and marker overlays.
const previewCss = readFileSync(resolve(__dirname, 'trace-preview.css'), 'utf8');
const ready: Extract<TracePreviewState, { kind: 'ready' }> = {
  kind: 'ready',
  width: 100,
  height: 100,
  svg: '<svg viewBox="0 0 100 100"><path id="hole" d="M0 0H100V100H0ZM20 20H80V80H20Z" fill="#000000" fill-rule="evenodd" stroke="none"/><path id="line" d="M10 50H90" fill="none" stroke="#b60000" stroke-width="1"/></svg>',
  paths: [
    {
      color: '#b60000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 10, y: 50 },
            { x: 90, y: 50 },
          ],
        },
      ],
    },
  ],
};
let host: HTMLDivElement;
let root: Root;
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  stylesheet = document.createElement('style');
  stylesheet.textContent = previewCss;
  document.head.appendChild(stylesheet);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  stylesheet.remove();
});

describe('TracePreview visible feedback', () => {
  it.each([
    ['decoding', 'Preparing image for tracing', 'Decoding image...'],
    ['tracing', 'Tracing image', 'Tracing...'],
  ] as const)(
    'shows indeterminate %s feedback even in Trace view',
    async (kind, label, message) => {
      const onBoundaryChange = vi.fn();
      await render({ state: { kind }, onBoundaryChange });
      await click('Show trace result');
      const viewport = host.querySelector('[aria-label="Preview viewport"]') as HTMLDivElement;
      Object.defineProperties(viewport, {
        clientWidth: { value: 300 },
        clientHeight: { value: 200 },
      });
      await click('Zoom in');
      viewport.scrollLeft = 150;
      viewport.scrollTop = 100;

      const progress = host.querySelector('[role="progressbar"]');
      expect(progress).not.toBeNull();
      expect(progress?.getAttribute('aria-label')).toBe(label);
      expect(progress?.hasAttribute('aria-valuenow')).toBe(false);
      expect(progress?.textContent).not.toMatch(/\d+%/);
      expect(progress?.closest('[hidden]')).toBeNull();
      // The fixed feedback layer cannot inherit the zoom stage's scroll position.
      expect(viewport.contains(progress)).toBe(false);
      expect(viewport.parentElement?.contains(progress)).toBe(true);
      expect(host.querySelector('[aria-label="Trace source image"]')?.hasAttribute('hidden')).toBe(
        true,
      );
      expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
      expect(viewport.getAttribute('aria-busy')).toBe('true');
      expect(onBoundaryChange).not.toHaveBeenCalled();

      await render({ state: ready, onBoundaryChange });
      expect(host.querySelector('[role="progressbar"]')).toBeNull();
      expect(viewport.getAttribute('aria-busy')).toBe('false');
      expect(host.querySelector('#line')).not.toBeNull();
    },
  );

  it('clears visible progress on failure and stays clear while idle', async () => {
    await render({ state: { kind: 'tracing' }, sourceDataUrl: '' });
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
    await render({ state: { kind: 'error', message: 'The image could not be decoded.' } });
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be decoded');
    await render({ state: { kind: 'idle' } });
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Preview is waiting for an image.',
    );
  });

  it('tints only painted trace geometry in Overlay and retains output colours and marker paint', async () => {
    await render({ state: ready });
    await click('Show Points');
    const hole = host.querySelector('#hole') as SVGPathElement;
    const line = host.querySelector('#line') as SVGPathElement;
    const marker = host.querySelector('[aria-label="Trace points"] circle') as SVGCircleElement;
    const geometry = [hole.outerHTML, line.outerHTML, marker.outerHTML];
    expect(getComputedStyle(hole).fill).toBe('var(--lf-accent)');
    expect(getComputedStyle(line).stroke).toBe('var(--lf-accent)');
    expect(getComputedStyle(hole).stroke).not.toBe('var(--lf-accent)');
    expect(getComputedStyle(line).fill).not.toBe('var(--lf-accent)');
    expect(getComputedStyle(marker).fill).not.toBe('var(--lf-accent)');
    expect(button('Show overlay').title).toMatch(/blue/i);
    expect(button('Show trace result').title).toMatch(/output colours/i);

    for (const label of ['Show original image', 'Show trace result']) {
      await click(label);
      expect(getComputedStyle(hole).fill).not.toBe('var(--lf-accent)');
      expect(getComputedStyle(line).stroke).not.toBe('var(--lf-accent)');
      expect([hole.outerHTML, line.outerHTML, marker.outerHTML]).toEqual(geometry);
    }
    await click('Show overlay');
    expect(getComputedStyle(line).stroke).toBe('var(--lf-accent)');
    expect(host.querySelector('#hole')).toBe(hole);
    expect(host.querySelector('#line')).toBe(line);
    expect(hole.getAttribute('fill-rule')).toBe('evenodd');
    expect(line.getAttribute('fill')).toBe('none');
    expect(ready.svg).toContain('stroke="#b60000"');
  });
});

async function render(overrides: Partial<PreviewProps>): Promise<void> {
  await act(async () => {
    root.render(
      createElement(TracePreview, {
        state: ready,
        sourceDataUrl: 'data:image/png;base64,AAA',
        imageSize: { width: 100, height: 100 },
        ...overrides,
      }),
    );
  });
}

function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent === label,
  );
  if (result === undefined) throw new Error(`Missing preview button: ${label}`);
  return result;
}

async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}
