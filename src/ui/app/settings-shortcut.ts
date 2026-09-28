// Ctrl+, (Cmd+, on macOS) opens Edit → Settings (LBG-F18), the desktop
// convention for preferences. It types nothing, so it works from a text field
// as well; while a dialog owns the keyboard the window-level handler is not
// consulted at all (use-shortcuts.ts). Ctrl+. beside it stays Abort, handled
// on its own listener (use-job-shortcuts.ts), so a slip onto the comma opens a
// window instead of stopping a job — and Ctrl+. still aborts over it.

export function handleSettingsShortcut(e: KeyboardEvent, openSettings: () => void): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key !== ',') return false;
  e.preventDefault();
  openSettings();
  return true;
}
