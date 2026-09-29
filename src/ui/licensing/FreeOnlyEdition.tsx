import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  EditionContext,
  LICENCE_SETTINGS_EVENT,
  setActiveEdition,
  type EditionValue,
} from './edition';
import { ProInDesktopDialog } from './ProInDesktopDialog';
import type { ProFeature } from './pro-features';

/**
 * Pro requests in a build that cannot take a licence only explain (ADR-544).
 * `shown` is the Pro tool being explained, or 'all' for the notice that every
 * Pro feature is in the desktop app.
 */
export function useProInDesktop(): {
  readonly shown: ProFeature | 'all' | null;
  readonly request: (feature: ProFeature) => boolean;
  readonly showAll: () => void;
  readonly close: () => void;
} {
  const [shown, setShown] = useState<ProFeature | 'all' | null>(null);
  const request = useCallback((next: ProFeature): boolean => {
    setShown(next);
    return false;
  }, []);
  const showAll = useCallback(() => setShown('all'), []);
  const close = useCallback(() => setShown(null), []);
  return { shown, request, showAll, close };
}

/** Runs `show` whenever Help > Licence is chosen. */
export function useLicenceSettingsEvent(show: () => void): void {
  useEffect(() => {
    window.addEventListener(LICENCE_SETTINGS_EVENT, show);
    return () => window.removeEventListener(LICENCE_SETTINGS_EVENT, show);
  }, [show]);
}

/** KerfDesk Free for the web app once sales open: it has no licence adapter. */
export function FreeOnlyEdition({ children }: { readonly children: ReactNode }): JSX.Element {
  const desktop = useProInDesktop();
  useLicenceSettingsEvent(desktop.showAll);
  const value = useMemo<EditionValue>(
    () => ({
      status: null,
      licensed: false,
      pro: false,
      proInDesktop: true,
      requestPro: desktop.request,
      openLicence: desktop.showAll,
    }),
    [desktop.request, desktop.showAll],
  );
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  return (
    <EditionContext.Provider value={value}>
      {children}
      {desktop.shown === null ? null : (
        <ProInDesktopDialog feature={desktop.shown} onClose={desktop.close} />
      )}
    </EditionContext.Provider>
  );
}
