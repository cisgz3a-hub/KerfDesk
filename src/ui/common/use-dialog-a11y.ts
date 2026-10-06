// Dialog accessibility hook — wires the four keyboard / focus behaviours
// every modal dialog must satisfy per WCAG 2.1 dialog pattern + the
// project's R-M1 audit finding:
//
//   1. Escape closes the dialog.
//   2. Tab / Shift+Tab cycle within the dialog (focus trap).
//   3. Initial focus lands on the first main control on mount.
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
// - We capture `previouslyFocused` during the first render, before a child
//   autoFocus control can take focus. Rerenders and StrictMode effect replay
//   retain that original opener.

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  dialogControlIsUnavailable,
  recoverDialogFocus,
  restoreDialogFocus,
} from './recover-dialog-focus';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type DialogInitialFocus = 'first-control' | 'surface';

type DialogA11yOptions = {
  readonly closeOnEscape?: boolean;
  readonly initialFocus?: DialogInitialFocus;
};

export function useDialogA11y(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  options: DialogA11yOptions = {},
): void {
  // A passive effect runs after React has focused autoFocus descendants.
  // Capture the opener before mounting them, then keep it across rerenders
  // and StrictMode's setup/cleanup replay rather than recapturing an inner field.
  const [previouslyFocused] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  // Hold the latest onClose in a ref so Escape always calls the current handler
  // WITHOUT making the focus-setup effect depend on onClose's identity. Callers
  // routinely pass a fresh arrow each render (onClose={() => setOpen(false)}); a
  // parent that re-renders — e.g. LaserWindow on its 250 ms status poll — would
  // otherwise re-run this effect every poll, yanking focus back to the first
  // field and collapsing any open <select> the operator just clicked.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const node = ref.current;
    if (node === null) return undefined;

    // Initial focus — the first main control, or the dialog itself
    // (which becomes focusable when we set tabindex="-1" on it in JSX).
    initialFocusTarget(node, optionsRef.current).focus();
    const releaseFocusRecovery = recoverDialogFocus(node, FOCUSABLE_SELECTOR, () =>
      isTopmostModal(node),
    );

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isTopmostModal(node)) return;
      // Escape/Tab can belong to an IME candidate window rather than the modal.
      // Keep native composition in charge without reaching enclosing shortcuts.
      if (e.isComposing || e.keyCode === 229) {
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape' && optionsRef.current.closeOnEscape !== false) {
        e.preventDefault();
        // Closing can remove the modal gate before this event reaches window.
        // Keep the same Escape from also acting on the underlying workspace.
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      trapTabWithin(node, e);
    };

    node.addEventListener('keydown', onKeyDown);
    return (): void => {
      node.removeEventListener('keydown', onKeyDown);
      releaseFocusRecovery();
      // Return focus to whatever opened us — typically a toolbar button.
      // Guard against the element having been removed from the DOM in
      // the meantime (e.g., a layout swap during dialog lifetime).
      restoreDialogFocus(node, previouslyFocused);
    };
    // The saved opener is stable for the dialog's lifetime. Read onClose via
    // its ref so a fresh callback never reruns focus setup or replaces the opener.
  }, [ref, previouslyFocused]);
}

function initialFocusTarget(node: HTMLElement, options: DialogA11yOptions): HTMLElement {
  if (options.initialFocus === 'surface') return node;
  // Supplemental help stays keyboard reachable without replacing the main control on open.
  return (
    Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
      (element) =>
        !dialogControlIsUnavailable(element) &&
        element.closest('[data-dialog-secondary-focus]') === null,
    ) ?? node
  );
}

function isTopmostModal(node: HTMLElement): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return dialogs[dialogs.length - 1] === node;
}

function trapTabWithin(node: HTMLElement, event: KeyboardEvent): void {
  const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !dialogControlIsUnavailable(element) && element.offsetParent !== null,
  );
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || active === node)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (active === node || active === last)) {
    event.preventDefault();
    first.focus();
  }
}
