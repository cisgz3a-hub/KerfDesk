// useSpacePan — wires the global Space-down state used by the Workspace
// pan-drag branch (F-A15). Kept out of useShortcuts so that file stays
// under the function-line cap, and so the listeners can be installed at
// the App root without ordering concerns.
//
// Why a separate hook: Space is a UX modifier that crosses module
// boundaries (keyboard state read by the workspace mouse handlers), so
// it belongs in the ui-store; this hook is just the listener that keeps
// the store in sync with the OS.

import { useEffect } from 'react';
import { isKeyboardActivationTarget } from '../common/keyboard-targets';
import { useUiStore } from '../state/ui-store';

export function useSpacePan(): void {
  const setSpaceDown = useUiStore((s) => s.setSpaceDown);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isKeyboardActivationTarget(e.target)) {
        // Don't preventDefault unconditionally — scrolling pages use
        // Space too; just preventing space from scrolling when no
        // editable target is focused is harmless inside the app.
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    const onBlur = (): void => setSpaceDown(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [setSpaceDown]);
}
