// design-shortcuts — the Studio's own keymap (ADR-268, DS-2).
//
// Bound to the overlay root div, never to window. App-level shortcuts are
// already suppressed wholesale by useRegisterModal, so the Studio is free to
// re-use Ctrl+Z / Ctrl+Y and the bare letter keys without collision.
//
// Esc is a LADDER, not a close (the ADR-242 pattern): it steps back through
// whatever is in progress and only closes the Studio when there is nothing left
// to back out of. Closing is never a prompt — the session is stashed.

import { designToolForShortcut } from './design-tool';
import { useDesignStudioStore } from './design-studio-store';

export function handleDesignStudioKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  onFit: () => void,
): void {
  // Never steal keys from a real text field inside the Studio.
  if (isTextEntry(event.target)) return;
  const store = useDesignStudioStore.getState();
  if (store.session === null) return;

  if (event.ctrlKey || event.metaKey) {
    handleChord(event);
    return;
  }
  if (event.altKey) return;

  if (event.key === 'Escape') {
    handleEscapeLadder();
    event.preventDefault();
    return;
  }
  handlePlainKey(event, onFit);
}

function handleChord(event: React.KeyboardEvent<HTMLDivElement>): void {
  const store = useDesignStudioStore.getState();
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    store.undo();
    event.preventDefault();
    return;
  }
  if (key === 'y' || (key === 'z' && event.shiftKey)) {
    store.redo();
    event.preventDefault();
  }
}

// Plain letters belong to TOOLS — that is the muscle memory worth protecting,
// and every tool has one. View toggles therefore take the Shift variant of the
// same letter rather than stealing f / o / g from Fillet, Offset and Polygon.
function handlePlainKey(event: React.KeyboardEvent<HTMLDivElement>, onFit: () => void): void {
  const store = useDesignStudioStore.getState();
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    handleViewToggle(key, onFit, event);
    return;
  }
  const tool = designToolForShortcut(key);
  if (tool !== null) {
    store.setTool(tool.kind);
    event.preventDefault();
  }
}

function handleViewToggle(
  key: string,
  onFit: () => void,
  event: React.KeyboardEvent<HTMLDivElement>,
): void {
  const store = useDesignStudioStore.getState();
  const toggles: Readonly<Record<string, () => void>> = {
    f: onFit,
    s: store.toggleSnap,
    o: store.toggleOrtho,
    g: store.toggleGrid,
  };
  const run = toggles[key];
  if (run === undefined) return;
  run();
  event.preventDefault();
}

// Five rungs, smallest retreat first: discard the live draft, then the live
// marquee, then the selection, then return to Select, and only then close. Esc
// never destroys more than the operator expected — and unlike the main
// workspace's draw tool, an abandoned draft here is genuinely discarded rather
// than committed on the following pointer-up.
function handleEscapeLadder(): void {
  const store = useDesignStudioStore.getState();
  const session = store.session;
  if (session === null) return;
  if (session.draft !== null) {
    store.setDraft(null);
    return;
  }
  if (session.marquee !== null) {
    store.setMarquee(null);
    return;
  }
  if (session.selectedIds.size > 0) {
    store.setSelection([]);
    return;
  }
  if (session.tool !== 'select') {
    store.setTool('select');
    return;
  }
  store.closeStudio();
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
