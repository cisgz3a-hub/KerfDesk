import type { KeyboardEvent } from 'react';
import { movePopoverFocus } from '../common/AnchoredPopover';
import { isMenuAbortShortcut } from './menu-keyboard';

/** Keep menu navigation and scrolling from also editing artwork or moving the machine. */
export function handleWorkspaceContextKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (isMenuAbortShortcut(event)) return;
  event.stopPropagation();
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if (event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault();
    return;
  }
  // Page keys retain native scrolling; Enter, Space and Tab keep their native
  // button/focus behavior. Arrow and boundary keys move between enabled rows.
  movePopoverFocus(event);
}
