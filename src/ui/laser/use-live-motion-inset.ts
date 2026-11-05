// While the Live Motion bar shows, it publishes the height it covers at the
// bottom of the window as --lf-live-motion-inset, so dialogs keep their
// footers and focused controls above it. At 1366 × 768 a job's ABORT JOB sat
// over the Keyboard Shortcuts window's focused Close (UX audit U7-P3-2, WCAG
// 2.2 SC 2.4.11). The bar stays on top; the dialogs move.

import { useLayoutEffect, type RefObject } from 'react';

export const LIVE_MOTION_INSET_PROPERTY = '--lf-live-motion-inset';
// The bar's own gap to the window edge (barStyle.bottom) plus breathing room.
const BAR_BOTTOM_PX = 34;
const GAP_PX = 8;

export function useLiveMotionInset(bar: RefObject<HTMLElement>, shown: boolean): void {
  useLayoutEffect(() => {
    const element = bar.current;
    if (!shown || element === null) return;
    const root = document.documentElement;
    const publish = (): void => {
      const height = element.getBoundingClientRect().height;
      root.style.setProperty(LIVE_MOTION_INSET_PROPERTY, `${height + BAR_BOTTOM_PX + GAP_PX}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(LIVE_MOTION_INSET_PROPERTY);
    };
  }, [bar, shown]);
}
