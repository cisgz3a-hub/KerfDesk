// Ctrl+K (Cmd+K on macOS) opens the command search, the shortcut most desktop
// apps use for "find a command". It types nothing, so it works from a text
// field as well; while a dialog owns the keyboard the window-level handler is
// not consulted at all (use-shortcuts.ts). preventDefault keeps the browser
// from moving focus to its own search box.

export function handleCommandSearchShortcut(e: KeyboardEvent, openSearch: () => void): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  if (e.key.toLowerCase() !== 'k') return false;
  e.preventDefault();
  openSearch();
  return true;
}
