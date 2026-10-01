import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { BROWSER_FREE_BUILD } from '../../platform/build-capabilities';
import {
  EditionContext,
  LICENCE_SETTINGS_EVENT,
  setActiveEdition,
  type EditionValue,
} from './edition';
import { UNLICENSED_BUILDS_RUN_FREE } from './edition-policy';
import { FreeOnlyEdition, useLicenceSettingsEvent, useProInDesktop } from './FreeOnlyEdition';
import { BrowserUpdatesNotice, CommercialUpdates } from './CommercialUpdates';
import { LicencePanel } from './LicencePanel';
import { panelOverlay, useDismissOnEscape } from './panel-overlay';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { ProFeatureDialog } from './ProFeatureDialog';
import { ProInDesktopDialog } from './ProInDesktopDialog';
import type { ProFeature } from './pro-features';
import { createTrialExpiryClock, expireTrialStatus } from './trial-expiry';
import { useTrialExpiry } from './use-trial-expiry';

export { LICENCE_SETTINGS_EVENT };

type PendingPro = { readonly feature: ProFeature; readonly onAllowed?: (() => void) | undefined };

function openLicence(): void {
  window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT));
}

/**
 * Supplies the Free/Pro edition to the app (ADR-540). The workspace always
 * mounts at once: a licence never blocks opening KerfDesk, a project or a
 * machine. Builds without a licence adapter run Free. The browser build's
 * fixed capabilities cannot be unlocked by passing a desktop licence client.
 */
export function EditionProvider({
  client,
  unlicensedRunsFree = UNLICENSED_BUILDS_RUN_FREE,
  children,
}: {
  readonly client?: LicenceAdapter;
  readonly unlicensedRunsFree?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  if (BROWSER_FREE_BUILD || client === undefined)
    return (
      <>
        {BROWSER_FREE_BUILD || unlicensedRunsFree ? (
          <FreeOnlyEdition>{children}</FreeOnlyEdition>
        ) : (
          children
        )}
        <BrowserUpdatesNotice />
      </>
    );
  return (
    <LicensedEdition client={client} unlicensedRunsFree={unlicensedRunsFree}>
      {children}
    </LicensedEdition>
  );
}

function LicensedEdition({
  client,
  unlicensedRunsFree,
  children,
}: {
  readonly client: LicenceAdapter;
  readonly unlicensedRunsFree: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const session = useLicenceSession(client, unlicensedRunsFree);
  const desktop = useProInDesktop();
  // A desktop build without commercial metadata cannot take a licence.
  const freeBuild = unlicensedRunsFree && session.status?.channel === 'free';
  const { load, isPro } = session;
  const { showAll } = desktop;
  const { managing, closeManager } = useLicenceManager(freeBuild, load, showAll);
  const value = useMemo<EditionValue>(
    () => ({
      status: session.status,
      licensed: session.status?.channel === 'commercial',
      // Store mutations must also check elapsed time when browser timers slept.
      get pro() {
        return isPro();
      },
      proInDesktop: freeBuild,
      requestPro: freeBuild ? desktop.request : session.requestPro,
      openLicence: freeBuild ? showAll : openLicence,
    }),
    [desktop.request, freeBuild, isPro, session.requestPro, session.status, showAll],
  );
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  return (
    <EditionContext.Provider value={value}>
      {children}
      {managing ? (
        <div role="dialog" aria-modal="false" aria-label="KerfDesk licence" style={panelOverlay}>
          <LicencePanel
            client={client}
            status={session.status}
            failure={session.failure}
            onStatus={session.accept}
            onRetry={load}
            onClose={closeManager}
          />
        </div>
      ) : null}
      {session.pending !== null && !managing ? (
        freeBuild ? (
          <ProInDesktopDialog
            feature={session.pending.feature}
            onClose={() => session.settle(null)}
          />
        ) : (
          <ProFeatureDialog
            feature={session.pending.feature}
            client={client}
            status={session.status}
            onStatus={session.accept}
            onClose={() => session.settle(null)}
          />
        )
      ) : null}
      {desktop.shown === null ? null : (
        <ProInDesktopDialog feature={desktop.shown} onClose={desktop.close} />
      )}
      <CommercialUpdates client={client} updatesUntil={session.status?.updatesUntil ?? null} />
    </EditionContext.Provider>
  );
}

/** Help > Licence opens the Licence panel; a free build has none to manage. */
function useLicenceManager(
  freeBuild: boolean,
  load: () => Promise<void>,
  showProInDesktop: () => void,
): { readonly managing: boolean; readonly closeManager: () => void } {
  const [managing, setManaging] = useState(false);
  const manage = useCallback((): void => {
    if (freeBuild) {
      showProInDesktop();
      return;
    }
    setManaging(true);
    void load();
  }, [freeBuild, load, showProInDesktop]);
  useLicenceSettingsEvent(manage);
  const closeManager = useCallback(() => setManaging(false), []);
  // Help > Check for Updates opens its panel in the same place.
  useEffect(() => {
    window.addEventListener(CHECK_UPDATES_EVENT, closeManager);
    return () => window.removeEventListener(CHECK_UPDATES_EVENT, closeManager);
  }, [closeManager]);
  useDismissOnEscape(managing, closeManager);
  return { managing, closeManager };
}

/** The saved licence, and the Pro request waiting on it, for one running app. */
function useLicenceSession(client: LicenceAdapter, unlicensedRunsFree: boolean) {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPro | null>(null);
  const statusRef = useRef<LicenceStatus | null>(null);
  const statusRequest = useRef(0);
  const pendingRef = useRef<PendingPro | null>(null);
  const [trialClock] = useState(createTrialExpiryClock);
  const settle = useCallback((next: PendingPro | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);
  const accept = useCallback(
    async (reported: LicenceStatus, expected?: LicenceStatus): Promise<void> => {
      // A timer for an older trial cannot overwrite a completed paid activation.
      if (expected !== undefined && statusRef.current !== expected) return;
      // A completed action owns the new status. A read started before an
      // activation/deactivation must never overwrite its result when it arrives.
      statusRequest.current += 1;
      // A free desktop build has no commercial metadata and no Pro to unlock.
      const result: LicenceStatus =
        unlicensedRunsFree && reported.channel === 'free'
          ? { ...reported, edition: 'free' }
          : expireTrialStatus(reported, trialClock);
      statusRef.current = result;
      setStatus(result);
      setFailure(null);
      const waiting = pendingRef.current;
      if (waiting !== null && result.edition === 'pro') {
        // Pro was unlocked from the prompt: carry on into the tool that asked.
        settle(null);
        waiting.onAllowed?.();
      }
    },
    [settle, trialClock, unlicensedRunsFree],
  );
  const load = useCallback(async (): Promise<void> => {
    const request = ++statusRequest.current;
    try {
      const reported = await client.status();
      if (request === statusRequest.current) await accept(reported);
    } catch {
      if (request === statusRequest.current)
        setFailure('The licence service could not be reached. Please retry or restart KerfDesk.');
    }
  }, [accept, client]);
  useEffect(() => {
    void load();
  }, [load]);
  useTrialExpiry(status, accept, trialClock);
  const isPro = useCallback(
    () => statusRef.current?.edition === 'pro' && trialClock.remainingMs(statusRef.current) > 0,
    [trialClock],
  );
  const requestPro = useCallback(
    (feature: ProFeature, onAllowed?: () => void): boolean => {
      const current = statusRef.current;
      const next = current === null ? null : expireTrialStatus(current, trialClock);
      if (next !== null && next !== current) void accept(next);
      if (statusRef.current?.edition === 'pro') {
        onAllowed?.();
        return true;
      }
      settle({ feature, onAllowed });
      return false;
    },
    [accept, settle, trialClock],
  );
  return { status, failure, pending, settle, accept, load, requestPro, isPro };
}
