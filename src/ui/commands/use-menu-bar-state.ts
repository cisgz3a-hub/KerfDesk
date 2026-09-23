import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommandFamily } from './command-registry';
import { familySummary, isMenuAbortShortcut, menuItems } from './menu-keyboard';

export function useMenuBarState() {
  const [openFamily, setOpenFamily] = useState<CommandFamily | null>(null);
  const [focusedFamily, setFocusedFamily] = useState<CommandFamily>('file');
  const menuBarRef = useRef<HTMLElement | null>(null);
  const pendingMenuFocus = useRef<'first' | 'last' | null>(null);
  const pendingFamilyReturn = useRef<CommandFamily | null>(null);

  useLayoutEffect(() => {
    if (openFamily === null || pendingMenuFocus.current === null) return;
    const menu = menuBarRef.current?.querySelector(`[data-family-menu="${openFamily}"]`);
    const items = menuItems(menu);
    const target = pendingMenuFocus.current === 'last' ? items[items.length - 1] : items[0];
    pendingMenuFocus.current = null;
    (target ?? (menuBarRef.current && familySummary(menuBarRef.current, openFamily)))?.focus();
  }, [openFamily]);

  useLayoutEffect(() => {
    if (openFamily !== null || pendingFamilyReturn.current === null) return;
    const root = menuBarRef.current;
    if (root === null) return;
    familySummary(root, pendingFamilyReturn.current)?.focus();
    pendingFamilyReturn.current = null;
  }, [openFamily]);

  useEffect(() => installOutsideClose(openFamily, menuBarRef, setOpenFamily), [openFamily]);
  return {
    openFamily,
    setOpenFamily,
    focusedFamily,
    setFocusedFamily,
    menuBarRef,
    pendingMenuFocus,
    pendingFamilyReturn,
  };
}

function installOutsideClose(
  openFamily: CommandFamily | null,
  menuBarRef: React.RefObject<HTMLElement>,
  close: (family: null) => void,
): (() => void) | undefined {
  if (openFamily === null) return undefined;
  const outside = (event: PointerEvent | KeyboardEvent): void => {
    if (event instanceof KeyboardEvent && isMenuAbortShortcut(event)) return;
    const target = event.target;
    const root = menuBarRef.current;
    if (target instanceof Node && root?.contains(target)) return;
    handleOutsideInput(event, root, openFamily, close);
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', outside, true);
  return () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', outside, true);
  };
}

function handleOutsideInput(
  event: PointerEvent | KeyboardEvent,
  root: HTMLElement | null,
  family: CommandFamily,
  close: (family: null) => void,
): void {
  // A dismissing press must not also select, draw, or nudge behind the menu.
  event.stopPropagation();
  if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') event.preventDefault();
  if (root !== null) familySummary(root, family)?.focus();
  if (!(event instanceof KeyboardEvent) || event.key === 'Escape' || event.key === 'Tab') {
    close(null);
  }
}
