// Keeps a canvas's bitmap dimensions equal to its CSS layout size.
//
// The workspace canvas was hardcoded to 800×600 while its style says
// width/height 100%, so the browser stretched the bitmap to the panel
// box — anisotropic distortion at almost any window size (~1.4× vertical
// at a typical layout: circles rendered as ellipses, a WYSIWYG violation
// found by the 2026-06-10 live feature audit). Pointer mapping survived
// because view-transform divides by the rect per axis; with bitmap ==
// CSS size those ratios become identity and rendering is undistorted.
//
// Deliberately NOT devicePixelRatio-aware: drawScene's line widths and
// handle sizes are authored in bitmap pixels, so multiplying by DPR
// would thin every stroke on hiDPI screens. Sharpening for hiDPI is a
// separate, larger change.

import { useLayoutEffect, useState } from 'react';

export const CANVAS_FALLBACK_WIDTH = 800;
export const CANVAS_FALLBACK_HEIGHT = 600;

export type CanvasBitmapSize = {
  readonly width: number;
  readonly height: number;
};

const FALLBACK: CanvasBitmapSize = {
  width: CANVAS_FALLBACK_WIDTH,
  height: CANVAS_FALLBACK_HEIGHT,
};

export function useCanvasBitmapSize(
  ref: React.RefObject<HTMLCanvasElement | null>,
): CanvasBitmapSize {
  const [size, setSize] = useState<CanvasBitmapSize>(FALLBACK);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;

    const apply = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      // Unmeasurable (jsdom, display:none, mid-teardown): keep the last
      // good size rather than collapsing the bitmap to 0×0.
      if (width < 1 || height < 1) return;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
