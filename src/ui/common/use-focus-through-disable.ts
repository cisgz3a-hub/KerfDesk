// Keeps keyboard focus in place while a focused button turns itself off.
//
// Frame job and Set origin here disable themselves while they run. A disabled
// button drops focus to the page, so a screen reader announced nothing and lost
// its place, and Tab restarted from the top (UX audit U7-P3-1). This moves focus
// to the button's nearest labelled group (the machine panel's "Jog and
// positioning", "Job actions"...) while it is off, and back to the button when
// it returns, if focus is still on that group. The button stays truly disabled,
// so nothing can press it meanwhile.

import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useFocusThroughDisable<T extends HTMLElement>(disabled: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  const held = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const control = ref.current;
    if (control === null) return;
    if (disabled) {
      if (document.activeElement !== control) return;
      const group = control.parentElement?.closest<HTMLElement>('[aria-label]') ?? null;
      if (group === null) return;
      if (!group.hasAttribute('tabindex')) {
        group.setAttribute('tabindex', '-1');
        group.dataset.focusHeld = 'added';
      }
      group.focus({ preventScroll: true });
      held.current = group;
      return;
    }
    const group = held.current;
    if (group === null) return;
    held.current = null;
    if (document.activeElement === group) control.focus({ preventScroll: true });
    if (group.dataset.focusHeld === 'added') {
      group.removeAttribute('tabindex');
      delete group.dataset.focusHeld;
    }
  }, [disabled]);
  return ref;
}
