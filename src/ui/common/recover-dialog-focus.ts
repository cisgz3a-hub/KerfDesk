const UNAVAILABLE_ANCESTOR = '[hidden], [inert], [aria-hidden="true"]';

/** Recover focus lost when this modal's focused control is removed or disabled. */
export function recoverDialogFocus(
  node: HTMLElement,
  selector: string,
  isActiveModal: () => boolean,
): () => void {
  let focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const rememberFocus = (event: FocusEvent): void => {
    const target = event.target;
    // A deliberate move, including into a newer modal, replaces our ownership.
    focused =
      target instanceof HTMLElement && target.closest('[role="dialog"][aria-modal="true"]') === node
        ? target
        : null;
  };
  const observer = new MutationObserver(() => {
    const active = document.activeElement;
    if (focused === null || !node.isConnected || (active !== document.body && active !== focused)) {
      return;
    }
    if (node.contains(focused) && !isUnavailable(focused)) return;
    if (!isActiveModal()) return;
    const target = Array.from(node.querySelectorAll<HTMLElement>(selector)).find(
      (element) => !isUnavailable(element) && element.offsetParent !== null,
    );
    (target ?? node).focus();
  });
  document.addEventListener('focusin', rememberFocus);
  observer.observe(node, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden'],
  });
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', rememberFocus);
  };
}

function isUnavailable(element: HTMLElement): boolean {
  return element.matches(':disabled') || element.closest(UNAVAILABLE_ANCESTOR) !== null;
}

/** Return focus without taking it away from another dialog or a deliberate move. */
export function restoreDialogFocus(node: HTMLElement, target: HTMLElement | null): void {
  if (target === null || !target.isConnected) return;
  const active = document.activeElement;
  if (active !== null && active !== document.body && !node.contains(active)) return;
  const remaining = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ).filter((dialog) => dialog !== node);
  const topmost = remaining[remaining.length - 1];
  if (topmost !== undefined && !topmost.contains(target)) return;
  target.focus();
}
