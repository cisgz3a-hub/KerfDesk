import { useCallback, useEffect, useRef, useState } from 'react';
import { browserLocalStorage } from '../state/browser-local-storage';
import { useLaserStore } from '../state/laser-store';
import { isActiveJobStatus } from '../state/laser-store-helpers';
import { usePendingProProjectStore } from '../state/pending-pro-project';
import { useUiStore } from '../state/ui-store';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
import { DesktopWelcomeDialog } from './DesktopWelcomeDialog';

export const BROWSER_WELCOME_KEY = 'kerfdesk.browser-welcome.v1';

function alreadyDismissed(): boolean {
  try {
    return browserLocalStorage()?.getItem(BROWSER_WELCOME_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

/** First-visit choice, also reachable from the existing Free/Pro status button. */
export function BrowserDesktopWelcome({
  requested,
  onClose,
}: {
  readonly requested: boolean;
  readonly onClose: () => void;
}): JSX.Element | null {
  const [pending, setPending] = useState(() => !alreadyDismissed());
  const [automatic, setAutomatic] = useState(false);
  const closing = useRef(false);
  const modalDepth = useUiStore((state) => state.modalDepth);
  const preservedProject = usePendingProProjectStore((state) => state.pending !== null);
  const busy = useLaserStore(
    (state) =>
      isActiveJobStatus(state.streamer?.status ?? null) ||
      state.motionOperation !== null ||
      state.controllerOperation !== null ||
      state.fireActive ||
      state.mpgActive === true ||
      unownedControllerMotion(state) !== null,
  );
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setPending(false);
    setAutomatic(false);
    try {
      browserLocalStorage()?.setItem(BROWSER_WELCOME_KEY, 'dismissed');
    } catch {
      // Choosing Free must work even when browser storage is unavailable.
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!pending || automatic || requested || busy || preservedProject || modalDepth > 0)
      return undefined;
    const timer = window.setTimeout(() => setAutomatic(true), 700);
    return () => window.clearTimeout(timer);
  }, [pending, automatic, requested, busy, preservedProject, modalDepth]);

  const open = automatic || requested;
  useEffect(() => {
    if (!open) closing.current = false;
  }, [open]);
  useEffect(() => {
    if (open && (busy || preservedProject || modalDepth > 1)) close();
  }, [open, busy, preservedProject, modalDepth, close]);

  if (!open || busy || preservedProject) return null;
  return <DesktopWelcomeDialog onClose={close} />;
}
