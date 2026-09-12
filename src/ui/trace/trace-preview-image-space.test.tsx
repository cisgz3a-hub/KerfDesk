import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TracePreview } from './TracePreview';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sourceSize = { width: 10001, height: 3333 };
const ready: TracePreviewState = {
  kind: 'ready',
  width: 2048,
  height: 683,
  svg: '<svg viewBox="0 0 2048 683" preserveAspectRatio="xMidYMid meet"><path id="rounded-grid" d="M0 0L2048 683"/></svg>',
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 2048, y: 683 },
          ],
        },
      ],
    },
  ],
};
type ResizeObserverStub = {
  readonly callback: ResizeObserverCallback;
  readonly disconnect: ReturnType<typeof vi.fn>;
  target?: Element;
};
let observers: ResizeObserverStub[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly disconnect = vi.fn();
      target?: Element;
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(target: Element): void {
        this.target = target;
      }
    },
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('TracePreview original image space', () => {
  it('aligns unequal rounded thumbnail, trace and boundary grids at high zoom', async () => {
    const onBoundaryChange = vi.fn();
    await act(async () =>
      root.render(
        <TracePreview
          state={ready}
          sourceDataUrl="data:image/bmp;base64,AAA"
          imageSize={sourceSize}
          boundary={{ x: 0, y: 0, ...sourceSize }}
          onBoundaryChange={onBoundaryChange}
        />,
      ),
    );
    const image = host.querySelector('img') as HTMLImageElement;
    Object.defineProperties(image, { naturalWidth: { value: 256 }, naturalHeight: { value: 85 } });
    for (let index = 0; index < 4; index += 1) await click('Zoom in');
    await resize(observers.at(-1), 9600, 5760);
    const rectangle = artwork();
    expect(parseFloat(rectangle.style.width)).toBe(9600);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo((9600 * 3333) / 10001, 8);
    expect(parseFloat(rectangle.style.top)).toBeCloseTo((5760 - (9600 * 3333) / 10001) / 2, 8);
    expect(image.parentElement).toBe(rectangle);
    await click('Show Points');
    const trace = host.querySelector('#rounded-grid')?.closest('svg');
    expect(trace?.getAttribute('viewBox')).toBe('0 0 2048 683');
    expect(trace?.getAttribute('preserveAspectRatio')).toBe('none');
    expect(
      host.querySelector('[aria-label="Trace points"]')?.getAttribute('preserveAspectRatio'),
    ).toBe('none');
    expect(host.querySelector('[aria-label="Trace boundary"]')?.parentElement).toBe(rectangle);

    // Select visible source coordinates after panning the enlarged original rectangle.
    const stage = host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement;
    stage.getBoundingClientRect = () =>
      ({ left: -1500, top: -1600, width: 9600, height: 5760 }) as DOMRect;
    const scale = 9600 / 10001;
    const top = -1600 + parseFloat(rectangle.style.top);
    await act(async () => {
      stage.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: -1500 + 2000.25 * scale,
          clientY: top + 500.25 * scale,
        }),
      );
      stage.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: -1500 + 2100.25 * scale,
          clientY: top + 650.25 * scale,
        }),
      );
    });
    expect(onBoundaryChange).toHaveBeenCalledWith({ x: 2000, y: 500, width: 100, height: 150 });
    expect(host.querySelector('#rounded-grid')?.getAttribute('d')).toBe('M0 0L2048 683');
  });

  it('refits after layout changes without replacing path DOM and ignores retired observers', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <TracePreview state={ready} imageSize={sourceSize} />
        </StrictMode>,
      ),
    );
    expect(observers).toHaveLength(2);
    const first = observers[0];
    const current = observers[1];
    expect(first?.disconnect).toHaveBeenCalledTimes(1);
    const path = host.querySelector('#rounded-grid');
    await resize(current, 600, 400);
    expect(parseFloat(artwork().style.width)).toBe(600);
    await resize(current, 400, 800);
    expect(parseFloat(artwork().style.width)).toBe(400);
    expect(parseFloat(artwork().style.top)).toBeCloseTo((800 - (400 * 3333) / 10001) / 2, 8);
    await resize(first, 9600, 5760);
    expect(parseFloat(artwork().style.width)).toBe(400);
    expect(host.querySelector('#rounded-grid')).toBe(path);
  });
});

function artwork(): HTMLDivElement {
  const rectangle = host.querySelector<HTMLDivElement>('.lf-trace-preview__artwork');
  if (rectangle === null) throw new Error('Missing canonical artwork rectangle');
  return rectangle;
}

async function resize(
  observer: ResizeObserverStub | undefined,
  width: number,
  height: number,
): Promise<void> {
  if (observer?.target === undefined) throw new Error('Preview has no active size observer');
  await act(async () =>
    observer.callback(
      [{ target: observer.target, contentRect: { width, height } } as ResizeObserverEntry],
      observer as unknown as ResizeObserver,
    ),
  );
}

async function click(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  );
  if (button === undefined) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
