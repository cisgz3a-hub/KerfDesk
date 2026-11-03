// hideOutsideModal — hides everything behind an open modal from assistive
// technology (UX audit U7-P2-2).
//
// Chromium does not prune its accessibility tree for `aria-modal="true"`, so a
// screen reader's browse mode read the whole workspace behind every dialog as
// if none were open. Each element beside the path from the dialog up to <body>
// gets `aria-hidden="true"` while the dialog is the topmost modal.
//
// It is aria-hidden, not `inert`: pointer input behind the backdrop is already
// stopped by the backdrop, and the Live Motion bar must keep working under a
// dialog. Elements matching MODAL_REACHABLE stay exposed, and so does the path
// down to them: the Live Motion bar (ABORT JOB, its announcements) and any
// alert, so an alarm raised while a dialog is open is still spoken.
//
// Several modals can be stacked; a per-element count keeps an element hidden
// until the last modal that hid it lets go, and an element that already had
// its own aria-hidden is never touched.

export const MODAL_REACHABLE_ATTRIBUTE = 'data-modal-reachable';

const MODAL_REACHABLE = `[${MODAL_REACHABLE_ATTRIBUTE}], [role="alert"], [aria-live="assertive"]`;
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META']);

const hiddenCounts = new WeakMap<Element, number>();

/** Hide what is outside `node` while `isActive()` holds; returns the release. */
export function hideOutsideModal(node: HTMLElement, isActive: () => boolean): () => void {
  let hidden = new Set<Element>();
  const apply = (): void => {
    const next = node.isConnected ? elementsOutside(node) : new Set<Element>();
    for (const element of next) if (!hidden.has(element)) hideElement(element);
    for (const element of hidden) if (!next.has(element)) showElement(element);
    hidden = next;
  };
  if (isActive()) apply();
  // A new sibling (a later popup) or an alert that mounts deep inside a hidden
  // panel changes what must be hidden. A modal stacked above this one owns
  // the screen until it closes; its removal is a change here too.
  let scheduled = false;
  const observer = new MutationObserver((records) => {
    if (scheduled || !records.some((record) => changesOutside(node, record))) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (isActive()) apply();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const element of hidden) showElement(element);
    hidden = new Set();
  };
}

function elementsOutside(node: HTMLElement): Set<Element> {
  const result = new Set<Element>();
  for (let path: Element = node; path.parentElement !== null; path = path.parentElement) {
    if (path === document.body) break;
    for (const sibling of Array.from(path.parentElement.children)) {
      if (sibling !== path) collectHidden(sibling, result);
    }
  }
  return result;
}

function collectHidden(element: Element, result: Set<Element>): void {
  if (SKIPPED_TAGS.has(element.tagName) || element.matches(MODAL_REACHABLE)) return;
  if (element.querySelector(MODAL_REACHABLE) === null) {
    result.add(element);
    return;
  }
  for (const child of Array.from(element.children)) collectHidden(child, result);
}

function changesOutside(node: HTMLElement, record: MutationRecord): boolean {
  if (node.contains(record.target)) return false;
  // A sibling of the dialog's own path came or went, such as a stacked modal.
  const besidePath = record.target.contains(node);
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return nodes.some(
    (changed) =>
      changed instanceof Element &&
      (besidePath ||
        changed.matches(MODAL_REACHABLE) ||
        changed.querySelector(MODAL_REACHABLE) !== null),
  );
}

function hideElement(element: Element): void {
  const count = hiddenCounts.get(element);
  if (count === undefined) {
    // Owned by its author: leave it, and never remove it on release.
    if (element.getAttribute('aria-hidden') === 'true') return;
    element.setAttribute('aria-hidden', 'true');
    hiddenCounts.set(element, 1);
    return;
  }
  hiddenCounts.set(element, count + 1);
}

function showElement(element: Element): void {
  const count = hiddenCounts.get(element);
  if (count === undefined) return;
  if (count > 1) {
    hiddenCounts.set(element, count - 1);
    return;
  }
  hiddenCounts.delete(element);
  element.removeAttribute('aria-hidden');
}
