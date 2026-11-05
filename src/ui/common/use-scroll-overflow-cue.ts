// Marks a horizontally scrolling strip whose text runs past its right edge,
// so CSS can fade that edge. The status bar's telemetry scrolls with its
// scrollbar hidden, and at 1366 px and below its messages were cut off with
// nothing to show the line goes on (UX audit U7-P3-7).

import { useLayoutEffect, useRef, type RefObject } from 'react';

export const OVERFLOW_CUE_ATTRIBUTE = 'data-more-right';

export function useScrollOverflowCue<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = (): void => {
      const more = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      if (more) element.setAttribute(OVERFLOW_CUE_ATTRIBUTE, '');
      else element.removeAttribute(OVERFLOW_CUE_ATTRIBUTE);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(element);
    // The messages change without the strip changing size.
    const mutation = new MutationObserver(update);
    mutation.observe(element, { subtree: true, childList: true, characterData: true });
    return () => {
      element.removeEventListener('scroll', update);
      resize?.disconnect();
      mutation.disconnect();
    };
  }, []);
  return ref;
}
