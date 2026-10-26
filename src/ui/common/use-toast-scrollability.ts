import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Fit notifications leave canvas gestures alone; overflowing stacks own their
 * pointer area so both text-wheel scrolling and the scrollbar work normally. */
export function useToastScrollability(
  contentKey: string,
  host: HTMLElement | null,
): {
  readonly ref: RefObject<HTMLDivElement>;
  readonly scrollable: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => setScrollable(element.scrollHeight > element.clientHeight);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [contentKey, host]);
  return { ref, scrollable };
}
