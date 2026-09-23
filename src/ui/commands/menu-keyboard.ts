import type { Dispatch, KeyboardEvent, MutableRefObject, SetStateAction } from 'react';
import type { CommandFamily } from './command-registry';

export interface MenuKeyboardContext {
  readonly root: HTMLElement | null;
  readonly openFamily: CommandFamily | null;
  readonly setOpenFamily: Dispatch<SetStateAction<CommandFamily | null>>;
  readonly setFocusedFamily: Dispatch<SetStateAction<CommandFamily>>;
  readonly pendingMenuFocus: MutableRefObject<'first' | 'last' | null>;
  readonly pendingFamilyReturn: MutableRefObject<CommandFamily | null>;
}

export function handleMenuKeyDown(
  event: KeyboardEvent<HTMLElement>,
  context: MenuKeyboardContext,
): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || context.root === null) return;
  const family = target.closest<HTMLElement>('[data-menu-family]')?.dataset.menuFamily as
    | CommandFamily
    | undefined;
  if (family === undefined) return;
  if (!menuOwnsKey(event, context.openFamily)) return;
  event.stopPropagation();
  if (event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault();
    return;
  }
  if (handleDismissKey(event, context, family)) return;
  if (target.closest('[data-menu-family-summary]') !== null) {
    handleSummaryKey(event, context, family);
  } else {
    const item = target.closest<HTMLButtonElement>(
      'button[role="menuitem"], button[role="menuitemcheckbox"]',
    );
    if (item !== null) handleItemKey(event, context, family, item);
  }
}

function menuOwnsKey(event: KeyboardEvent<HTMLElement>, openFamily: CommandFamily | null): boolean {
  // Software Abort remains reachable from every window state. A closed summary
  // owns only menu navigation; ordinary shortcuts resume after dismissal.
  if (isMenuAbortShortcut(event)) return false;
  if (openFamily !== null) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(
    event.key,
  );
}

function handleDismissKey(
  event: KeyboardEvent<HTMLElement>,
  context: MenuKeyboardContext,
  family: CommandFamily,
): boolean {
  if (event.key !== 'Escape' && event.key !== 'Tab') return false;
  if (event.key === 'Escape') event.preventDefault();
  context.pendingMenuFocus.current = null;
  context.pendingFamilyReturn.current = null;
  if (context.root !== null) familySummary(context.root, family)?.focus();
  context.setOpenFamily(null);
  return true;
}

export function isMenuAbortShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean {
  return event.key === '.' && (event.ctrlKey || event.metaKey) && !event.altKey;
}

function handleSummaryKey(
  event: KeyboardEvent<HTMLElement>,
  context: MenuKeyboardContext,
  family: CommandFamily,
): void {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    openMenuEdge(context, family, event.key === 'ArrowUp' ? 'last' : 'first');
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusFamilyBoundary(context, event.key === 'Home' ? 'first' : 'last');
    return;
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  focusAdjacentFamily(context, family, event.key === 'ArrowRight' ? 1 : -1, false);
}

function openMenuEdge(
  context: MenuKeyboardContext,
  family: CommandFamily,
  edge: 'first' | 'last',
): void {
  if (context.openFamily === family) {
    const items = menuItems(context.root?.querySelector(`[data-family-menu="${family}"]`));
    (edge === 'last' ? items[items.length - 1] : items[0])?.focus();
  } else {
    context.pendingMenuFocus.current = edge;
    context.setOpenFamily(family);
  }
}

function handleItemKey(
  event: KeyboardEvent<HTMLElement>,
  context: MenuKeyboardContext,
  family: CommandFamily,
  target: HTMLButtonElement,
): void {
  const items = menuItems(target.closest('[role="menu"]'));
  const index = items.indexOf(target);
  if (handleItemListKey(event, items, index)) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    focusAdjacentFamily(context, family, event.key === 'ArrowRight' ? 1 : -1, true);
    return;
  }
}

function handleItemListKey(
  event: KeyboardEvent<HTMLElement>,
  items: readonly HTMLButtonElement[],
  index: number,
): boolean {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
    return true;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    return true;
  }
  return false;
}

export function menuItems(menu: Element | null | undefined): HTMLButtonElement[] {
  return menu === null || menu === undefined
    ? []
    : [
        ...menu.querySelectorAll<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled), button[role="menuitemcheckbox"]:not(:disabled)',
        ),
      ];
}

export function familySummary(root: HTMLElement, family: CommandFamily): HTMLElement | undefined {
  return visibleFamilySummaries(root).find((item) => item.dataset.menuFamilySummary === family);
}

function visibleFamilySummaries(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-menu-family-summary]')];
}

function focusAdjacentFamily(
  context: MenuKeyboardContext,
  family: CommandFamily,
  delta: number,
  open: boolean,
): void {
  if (context.root === null) return;
  const summaries = visibleFamilySummaries(context.root);
  const current = summaries.findIndex((item) => item.dataset.menuFamilySummary === family);
  const next = summaries[(current + delta + summaries.length) % summaries.length];
  const nextFamily = next?.dataset.menuFamilySummary as CommandFamily | undefined;
  if (next === undefined || nextFamily === undefined) return;
  context.setFocusedFamily(nextFamily);
  next.focus();
  if (open || context.openFamily !== null) {
    context.pendingMenuFocus.current = open ? 'first' : null;
    context.setOpenFamily(nextFamily);
  }
}

function focusFamilyBoundary(context: MenuKeyboardContext, edge: 'first' | 'last'): void {
  if (context.root === null) return;
  const summaries = visibleFamilySummaries(context.root);
  const target = edge === 'first' ? summaries[0] : summaries[summaries.length - 1];
  const family = target?.dataset.menuFamilySummary as CommandFamily | undefined;
  if (target === undefined || family === undefined) return;
  context.setFocusedFamily(family);
  target.focus();
  if (context.openFamily !== null) {
    context.pendingMenuFocus.current = null;
    context.setOpenFamily(family);
  }
}
