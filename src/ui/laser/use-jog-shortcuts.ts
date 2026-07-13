import { useEffect } from 'react';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { isModalOpen, useUiStore } from '../state/ui-store';
import type { PhysicalJogDirection } from './jog-control-policy';

type JogShortcut =
  | { readonly kind: 'xy'; readonly direction: PhysicalJogDirection }
  | { readonly kind: 'z'; readonly direction: 1 | -1 };

const JOG_SHORTCUTS: Readonly<Record<string, JogShortcut>> = {
  ArrowUp: { kind: 'xy', direction: { x: 0, y: 1 } },
  ArrowDown: { kind: 'xy', direction: { x: 0, y: -1 } },
  ArrowLeft: { kind: 'xy', direction: { x: -1, y: 0 } },
  ArrowRight: { kind: 'xy', direction: { x: 1, y: 0 } },
  PageUp: { kind: 'z', direction: 1 },
  PageDown: { kind: 'z', direction: -1 },
};

export function installJogShortcuts(
  target: Window,
  args: {
    readonly disabled: () => boolean;
    readonly focusDisabled: () => boolean;
    readonly onJog: (direction: PhysicalJogDirection) => void;
    readonly onFocusJog: (direction: 1 | -1) => void;
  },
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (isModalOpen(useUiStore.getState()) || isEditableShortcutTarget(event.target)) return;
    const shortcut = JOG_SHORTCUTS[event.key];
    if (shortcut === undefined) return;
    const disabled = shortcut.kind === 'xy' ? args.disabled() : args.focusDisabled();
    if (disabled) return;
    event.preventDefault();
    if (shortcut.kind === 'xy') args.onJog(shortcut.direction);
    else args.onFocusJog(shortcut.direction);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function useJogShortcuts(args: {
  readonly disabled: boolean;
  readonly focusDisabled: boolean;
  readonly onJog: (direction: PhysicalJogDirection) => void;
  readonly onFocusJog: (direction: 1 | -1) => void;
}): void {
  useEffect(
    () =>
      installJogShortcuts(window, {
        disabled: () => args.disabled,
        focusDisabled: () => args.focusDisabled,
        onJog: args.onJog,
        onFocusJog: args.onFocusJog,
      }),
    [args.disabled, args.focusDisabled, args.onFocusJog, args.onJog],
  );
}
