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
  if (target.closest('[data-menu-family-summary]') !== null) {
    handleSummaryKey(event, context, family);
  } else if (target.getAttribute('role') === 'menuitem') {
    handleItemKey(event, context, family, target as HTMLButtonElement);
  }
}

function handleSummaryKey(
  event: KeyboardEvent<HTMLElement>,
  context: MenuKeyboardContext,
  family: CommandFamily,
): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    context.pendingMenuFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
    context.setOpenFamily(family);
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
  if (event.key !== 'Escape') return;
  event.preventDefault();
  context.pendingFamilyReturn.current = family;
  context.setOpenFamily(null);
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
    : [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
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
}
