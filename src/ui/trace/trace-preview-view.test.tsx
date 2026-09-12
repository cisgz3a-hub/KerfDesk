import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TracePreview } from './TracePreview';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PreviewProps = React.ComponentProps<typeof TracePreview>;
const ready: Extract<TracePreviewState, { kind: 'ready' }> = {
  kind: 'ready',
  svg: '<svg viewBox="0 0 200 100"><path id="preview-line" d="M20 10L60 40"/></svg>',
  width: 200,
  height: 100,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 20, y: 10 },
            { x: 60, y: 40 },
          ],
        },
        {
          closed: false,
          points: [
            { x: 80, y: 50 },
            { x: 100, y: 70 },
          ],
        },
      ],
    },
  ],
};
const initialProps: PreviewProps = {
  state: ready,
  sourceDataUrl: 'data:image/png;base64,AAA',
  imageSize: { width: 200, height: 100 },
};
let root: Root | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  root = undefined;
});

describe('TracePreview comparison and inspection', () => {
  it('starts in Overlay and switches layers without replacing the trace or points', async () => {
    await render();
    expect(button('Trace').getAttribute('aria-label')).toBe('Show trace result');
    expect(button('Overlay').getAttribute('aria-pressed')).toBe('true');
    expect(stage().querySelector('[aria-label="Trace points"]')).toBeNull();
    await click('Show Points');
    const trace = host.querySelector('#preview-line');
    const points = host.querySelector('[aria-label="Trace points"]');
    const firstPoint = points?.querySelector('circle');
    const image = source();

    await click('Original');
    expect(image.hidden).toBe(false);
    expect(trace?.closest('[hidden]')).not.toBeNull();
    expect(points?.closest('[hidden]')).not.toBeNull();
    expect(button('Show Points').disabled).toBe(true);

    await click('Trace');
    expect(image.hidden).toBe(true);
    expect(trace?.closest('[hidden]')).toBeNull();
    expect(points?.closest('[hidden]')).toBeNull();
    await click('Overlay');
    expect(image.hidden).toBe(false);
    expect(host.querySelector('#preview-line')).toBe(trace);
    expect(host.querySelector('[aria-label="Trace points"] circle')).toBe(firstPoint);
  });

  it('keeps Original unfaded while remembering the Overlay fade preference', async () => {
    await render();
    await click('Fade Image');
    expect(source().style.opacity).toBe('0.2');
    await click('Original');
    expect(source().style.opacity).toBe('1');
    expect(button('Fade Image').disabled).toBe(true);
    await click('Overlay');
    expect(source().style.opacity).toBe('0.2');
    expect(button('Fade Image').getAttribute('aria-pressed')).toBe('true');
  });

  it('zooms every layer together, preserves the viewport centre, and resets with Fit', async () => {
    const onBoundaryChange = vi.fn();
    await render({ onBoundaryChange });
    const viewport = host.querySelector('[aria-label="Preview viewport"]') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { value: 300 },
      clientHeight: { value: 200 },
    });
    expect(button('Zoom out').disabled).toBe(true);
    await click('Zoom in');
    expect(stage().style.width).toBe('200%');
    expect(stage().style.height).toBe('200%');
    expect(viewport.scrollLeft).toBe(150);
    expect(viewport.scrollTop).toBe(100);
    expect(source().parentElement?.parentElement).toBe(stage());
    expect(host.querySelector('#preview-line')?.closest('.lf-trace-preview__stage')).toBe(stage());
    await click('Zoom in');
    expect(stage().style.width).toBe('400%');
    await click('Zoom out');
    expect(stage().style.width).toBe('200%');
    await click('Fit');
    expect(stage().style.width).toBe('100%');
    expect(stage().style.height).toBe('100%');
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    expect(onBoundaryChange).not.toHaveBeenCalled();
    expect(host.querySelector('#preview-line')?.getAttribute('d')).toBe('M20 10L60 40');
  });

  it('maps a boundary through zoom, scrolling and letterboxing in every comparison mode', async () => {
    const onBoundaryChange = vi.fn();
    await render({ onBoundaryChange });
    await click('Zoom in');
    // The 2x stage is scrolled left/up; a 200x100 source is centred in its 600x400 area.
    stage().getBoundingClientRect = () =>
      ({ left: -110, top: -70, width: 600, height: 400 }) as DOMRect;
    for (const mode of ['Original', 'Trace', 'Overlay']) {
      await click(mode);
      await act(async () => {
        stage().dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 40 }),
        );
        stage().dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 130 }),
        );
      });
      const boundary = host.querySelector('[aria-label="Trace boundary"]');
      expect(boundary?.parentElement).toBe(source().parentElement);
      expect(boundary?.getAttribute('viewBox')).toBe('0 0 200 100');
      expect(boundary?.querySelector('rect')?.getAttribute('x')).toBe('40');
      await act(async () => {
        stage().dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, clientX: 130, clientY: 130 }),
        );
      });
      expect(onBoundaryChange).toHaveBeenLastCalledWith({ x: 40, y: 20, width: 40, height: 30 });
    }
    expect(onBoundaryChange).toHaveBeenCalledTimes(3);
  });

  it('keeps view controls local while replacing a pending trace with its new result', async () => {
    const onBoundaryChange = vi.fn();
    await render({ onBoundaryChange });
    await click('Trace');
    await click('Zoom in');
    await render({ state: { kind: 'tracing' }, onBoundaryChange });
    expect(button('Trace').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Tracing...');
    expect(host.querySelector('#preview-line')).toBeNull();
    await render({
      state: { ...ready, svg: ready.svg.replace('preview-line', 'new-preview') },
      onBoundaryChange,
    });
    expect(stage().style.width).toBe('200%');
    expect(source().hidden).toBe(true);
    expect(host.querySelector('#new-preview')).not.toBeNull();
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('uses Trace view when no source bitmap is available', async () => {
    await render({ sourceDataUrl: '' });
    expect(button('Trace').getAttribute('aria-pressed')).toBe('true');
    expect(button('Original').disabled).toBe(true);
    expect(button('Overlay').disabled).toBe(true);
    expect(host.querySelector('#preview-line')?.closest('[hidden]')).toBeNull();
  });

  it('bounds inspection zoom and leaves every view control separate from form submission', async () => {
    await render();
    const form = document.createElement('form');
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    host.before(form);
    form.appendChild(host);
    form.addEventListener('submit', onSubmit);
    try {
      for (let index = 0; index < 5; index += 1) await click('Zoom in');
      expect(stage().style.width).toBe('1600%');
      expect(button('Zoom in').disabled).toBe(true);
      for (let index = 0; index < 5; index += 1) await click('Zoom out');
      expect(stage().style.width).toBe('100%');
      expect(button('Zoom out').disabled).toBe(true);
      for (const label of ['Original', 'Trace', 'Overlay', 'Fade Image', 'Show Points', 'Fit']) {
        await click(label);
      }
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      form.replaceWith(host);
    }
  });

  it('cancels an unfinished boundary when the pointer leaves the stage', async () => {
    const onBoundaryChange = vi.fn();
    await render({ onBoundaryChange });
    stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    await act(async () => {
      stage().dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 10 }),
      );
      stage().dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 40 }),
      );
    });
    expect(host.querySelector('[aria-label="Trace boundary"]')).not.toBeNull();
    await act(async () => {
      stage().dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      );
      stage().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 60, clientY: 40 }));
    });
    expect(host.querySelector('[aria-label="Trace boundary"]')).toBeNull();
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });
});

describe('TracePreview status', () => {
  it.each([
    [{ kind: 'idle' }, 'Preview is waiting for an image.'],
    [{ kind: 'decoding' }, 'Decoding image...'],
    [{ kind: 'tracing' }, 'Tracing...'],
  ] as const)('announces the %s phase without reporting stale counts', async (state, message) => {
    await render({ state });
    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain(message);
    expect(status?.textContent).not.toContain('paths');
    expect(host.querySelector('[aria-label="Preview viewport"]')?.getAttribute('aria-busy')).toBe(
      state.kind === 'idle' ? 'false' : 'true',
    );
  });

  it('announces an error and reports result polylines and stored points when ready', async () => {
    await render({ state: { kind: 'error', message: 'Image could not be traced.' } });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Preview failed: Image could not be traced.',
    );
    await render();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain('2 paths');
    expect(status?.textContent).toContain('4 points');
    expect(status?.textContent).toContain('200 × 100 px');
  });

  it('reports an empty result honestly', async () => {
    await render({ state: { ...ready, paths: [], svg: '<svg viewBox="0 0 200 100"/>' } });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain('No trace paths found.');
    expect(status?.textContent).toContain('0 points');
  });
});

async function render(overrides: Partial<PreviewProps> = {}): Promise<void> {
  if (root === undefined) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () =>
    root?.render(createElement(TracePreview, { ...initialProps, ...overrides })),
  );
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

function stage(): HTMLDivElement {
  return host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement;
}

function source(): HTMLImageElement {
  return host.querySelector('[aria-label="Trace source image"]') as HTMLImageElement;
}
