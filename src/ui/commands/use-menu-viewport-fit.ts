import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const VIEWPORT_MARGIN = 8;
const MIN_MENU_HEIGHT = 120;

/**
 * Keeps an open app-menu dropdown inside the window. The dropdown hangs below
 * its menu title, so its height is capped at the room left below that title
 * (the list scrolls past it), and a dropdown that would cross the right edge
 * of a narrow window moves left instead.
 */
export function useMenuViewportFit(
  menuRef: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties {
  const [fit, setFit] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const menu = menuRef.current;
      const title = menu?.offsetParent;
      if (menu === null || menu === undefined || !(title instanceof HTMLElement)) return;
      const anchor = title.getBoundingClientRect();
      const overflowRight = anchor.left + menu.offsetWidth - (window.innerWidth - VIEWPORT_MARGIN);
      setFit({
        maxHeight: Math.max(MIN_MENU_HEIGHT, window.innerHeight - anchor.bottom - VIEWPORT_MARGIN),
        left:
          overflowRight > 0
            ? -Math.min(overflowRight, Math.max(0, anchor.left - VIEWPORT_MARGIN))
            : 0,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [menuRef, open]);
  return fit;
}
