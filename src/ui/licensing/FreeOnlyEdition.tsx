import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EditionContext, setActiveEdition, type EditionValue } from './edition';
import { ProInDesktopDialog } from './ProInDesktopDialog';
import type { ProFeature } from './pro-features';

/** Pro requests in a build that cannot take a licence only explain (ADR-544). */
export function useProInDesktop(): {
  readonly feature: ProFeature | null;
  readonly request: (feature: ProFeature) => boolean;
  readonly close: () => void;
} {
  const [feature, setFeature] = useState<ProFeature | null>(null);
  const request = useCallback((next: ProFeature): boolean => {
    setFeature(next);
    return false;
  }, []);
  const close = useCallback(() => setFeature(null), []);
  return { feature, request, close };
}

/** KerfDesk Free for the web app once sales open: it has no licence adapter. */
export function FreeOnlyEdition({ children }: { readonly children: ReactNode }): JSX.Element {
  const desktop = useProInDesktop();
  const value = useMemo<EditionValue>(
    () => ({
      status: null,
      licensed: false,
      pro: false,
      requestPro: desktop.request,
      openLicence: () => undefined,
    }),
    [desktop.request],
  );
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  return (
    <EditionContext.Provider value={value}>
      {children}
      {desktop.feature === null ? null : (
        <ProInDesktopDialog feature={desktop.feature} onClose={desktop.close} />
      )}
    </EditionContext.Provider>
  );
}
