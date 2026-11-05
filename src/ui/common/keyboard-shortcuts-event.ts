// Opens the Keyboard Shortcuts window from Help → Keyboard Shortcuts... and
// command search; the toolbar owns the window (UX audit U6-P3-2).

export const KEYBOARD_SHORTCUTS_EVENT = 'kerfdesk:keyboard-shortcuts';

export function openKeyboardShortcuts(): void {
  window.dispatchEvent(new Event(KEYBOARD_SHORTCUTS_EVENT));
}
