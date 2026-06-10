// useRegisterModal — counts the calling component into ui-store's
// modalDepth for its mounted lifetime, so the window-level shortcut
// handlers (use-shortcuts.ts) yield while the modal is open. Extracted
// from CommandShell when ConfirmSaveDialog became the second consumer.
//
// useLayoutEffect (not useEffect) so the registration lands in the same
// commit as the dialog's first paint — no frame where the dialog is
// visible but shortcuts still fire.

import { useLayoutEffect } from 'react';
import { useUiStore } from '../state/ui-store';

export function useRegisterModal(): void {
  const registerModal = useUiStore((s) => s.registerModal);
  const unregisterModal = useUiStore((s) => s.unregisterModal);
  useLayoutEffect(() => {
    registerModal();
    return unregisterModal;
  }, [registerModal, unregisterModal]);
}
