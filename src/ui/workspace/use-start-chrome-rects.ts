import { useLayoutEffect, useState } from 'react';
import type { StartLayoutRect } from './canvas-start-layout';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';

/** Keep handles clear of the actual zoom chip and start-settings panel. */
export function useStartChromeRects(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  size: CanvasBitmapSize,
): ReadonlyArray<StartLayoutRect> {
  const [rects, setRects] = useState<ReadonlyArray<StartLayoutRect>>([]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (canvas === null || parent === null || parent === undefined) return;
    const measure = () => {
      const origin = canvas.getBoundingClientRect();
      const next = [
        ...parent.querySelectorAll<HTMLElement>('[aria-label="Zoom"], .lf-start-settings'),
      ]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        }));
      setRects((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    const observed = new Set<Element>();
    const refresh = () => {
      for (const node of [
        canvas,
        ...parent.querySelectorAll('[aria-label="Zoom"], .lf-start-settings'),
      ]) {
        if (!observed.has(node)) {
          resize?.observe(node);
          observed.add(node);
        }
      }
      measure();
    };
    const mutation = new MutationObserver(refresh);
    mutation.observe(parent, { childList: true, subtree: true });
    refresh();
    return () => {
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [canvasRef, size.width, size.height]);
  return rects;
}
