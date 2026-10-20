import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  EditionContext,
  LICENCE_SETTINGS_EVENT,
  setActiveEdition,
  type EditionValue,
} from './edition';
import { ProInDesktopDialog } from './ProInDesktopDialog';
import type { ProFeature } from './pro-features';
import { BROWSER_FREE_BUILD } from '../../platform/build-capabilities';
import { BrowserDesktopWelcome } from './BrowserDesktopWelcome';

/**
 * Pro requests in a build that cannot take a licence only explain (ADR-544).
 * `shown` is the Pro tool being explained, or 'all' for the notice that every
 * Pro feature is in the desktop app. Neither notice keeps the tool's edit:
 * nothing here can unlock Pro, so there is no edit to run afterwards, and it
 * is never an open Pro prompt for background work (ADR-609).
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

/** KerfDesk Free for builds without a desktop licence adapter. */
export function FreeOnlyEdition({ children }: { readonly children: ReactNode }): JSX.Element {
  const desktop = useProInDesktop();
  const { request, showAll } = desktop;
  const browserWelcome = BROWSER_FREE_BUILD && window.location.protocol !== 'app:';
  useLicenceSettingsEvent(showAll);
  const value = useMemo<EditionValue>(
    () => ({
      status: null,
      licensed: false,
      pro: false,
      proInDesktop: true,
      // The desktop notice never holds an edit to run (see useProInDesktop).
      proPromptOpen: false,
      requestPro: request,
      openLicence: showAll,
    }),
    [request, showAll],
  );
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  return (
    <EditionContext.Provider value={value}>
      {children}
      {browserWelcome ? (
        <BrowserDesktopWelcome requested={desktop.shown === 'all'} onClose={desktop.close} />
      ) : null}
      {desktop.shown === null || (browserWelcome && desktop.shown === 'all') ? null : (
        <ProInDesktopDialog feature={desktop.shown} onClose={desktop.close} />
      )}
    </EditionContext.Provider>
  );
}
