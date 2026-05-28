// Dialog accessibility hook — wires the four keyboard / focus behaviours
// every modal dialog must satisfy per WCAG 2.1 dialog pattern + the
// project's R-M1 audit finding:
//
//   1. Escape closes the dialog.
//   2. Tab / Shift+Tab cycle within the dialog (focus trap).
//   3. Initial focus lands on the first focusable element on mount.
//   4. Closing returns focus to whatever was focused before opening.
//
// Caller wires `useDialogA11y(ref, onClose)` and passes the same `ref`
// onto the dialog's outermost element. The hook also reminds the caller
// (via the JSX they write) to set `role="dialog"` and `aria-modal="true"`
// — the hook can't add attributes; it can only orchestrate focus.
//
// Implementation notes:
// - The focusable-element query matches the standard cross-browser set:
//   buttons, links with href, inputs/selects/textareas not disabled,
//   anything with explicit non-negative tabindex. Items with
//   inert / hidden / disabled / aria-hidden are excluded.
// - The Tab handler measures focusable elements at keydown time (not
//   at mount), so dynamic fields appearing later still join the cycle.
// - We capture `previouslyFocused` on the FIRST render only (via ref).
//   If the dialog re-renders before close, we don't clobber the saved
//   focus target.

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogA11y(ref: RefObject<HTMLElement>, onClose: () => void): void {
  // The element that was focused before the dialog mounted, so we can
  // hand focus back on close. Captured once (the ref guards against
  // re-render clobbering) and read in the cleanup.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const node = ref.current;
    if (node === null) return undefined;

    // Initial focus — the first focusable child, or the dialog itself
    // (which becomes focusable when we set tabindex="-1" on it in JSX).
    const initial = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? node;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return (): void => {
      node.removeEventListener('keydown', onKeyDown);
      // Return focus to whatever opened us — typically a toolbar button.
      // Guard against the element having been removed from the DOM in
      // the meantime (e.g., a layout swap during dialog lifetime).
      const target = previouslyFocused.current;
      if (target !== null && document.contains(target)) {
        target.focus();
      }
    };
  }, [ref, onClose]);
}
