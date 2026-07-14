import { useEffect } from 'react';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { isModalOpen, useUiStore } from '../state/ui-store';

// Bare arrow keys are reserved for nudging the selected canvas object. They used
// to ALSO jog the machine, so with the rail connected and a shape selected one
// press both nudged the artwork and lurched the head across the bed (F104).
// Keyboard machine jog is now Z-focus only (PageUp/PageDown, which the canvas
// never binds); XY jogging lives on the jog pad, matching LightBurn.
const FOCUS_JOG_KEYS: Readonly<Record<string, 1 | -1>> = {
  PageUp: 1,
  PageDown: -1,
};

export function installJogShortcuts(
  target: Window,
  args: {
    readonly focusDisabled: () => boolean;
    readonly onFocusJog: (direction: 1 | -1) => void;
  },
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (isModalOpen(useUiStore.getState()) || isEditableShortcutTarget(event.target)) return;
    const direction = FOCUS_JOG_KEYS[event.key];
    if (direction === undefined) return;
    if (args.focusDisabled()) return;
    event.preventDefault();
    args.onFocusJog(direction);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function useJogShortcuts(args: {
  readonly focusDisabled: boolean;
  readonly onFocusJog: (direction: 1 | -1) => void;
}): void {
  useEffect(
    () =>
      installJogShortcuts(window, {
        focusDisabled: () => args.focusDisabled,
        onFocusJog: args.onFocusJog,
      }),
    [args.focusDisabled, args.onFocusJog],
  );
}
