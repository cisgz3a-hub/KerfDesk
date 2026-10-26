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
import { DESKTOP_LICENCE_WINDOW } from '../../../public/desktop-licence-window.mjs';
import { FreeOnlyEdition, useLicenceSettingsEvent, useProInDesktop } from './FreeOnlyEdition';
import { BrowserUpdatesNotice, CommercialUpdates } from './CommercialUpdates';
import { DesktopLicenceGate } from './DesktopLicenceGate';
import { LicencePanel } from './LicencePanel';
import { panelOverlay, useDismissOnEscape } from './panel-overlay';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { ProFeatureDialog } from './ProFeatureDialog';
import { ProInDesktopDialog } from './ProInDesktopDialog';
import type { ProFeature } from './pro-features';
import { createTrialExpiryClock, expireTrialStatus } from './trial-expiry';
import { useTrialExpiry } from './use-trial-expiry';
import { useLicenceLink } from './use-licence-link';

export { LICENCE_SETTINGS_EVENT };

/** The main process's data-free signal that a quiet licence confirmation finished. */
export const LICENCE_REFRESHED_EVENT = 'kerfdesk:licence-refreshed';

type PendingPro = { readonly feature: ProFeature; readonly onAllowed?: (() => void) | undefined };

function openLicence(): void {
  window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT));
}

/**
 * Supplies the edition to the app. With the licence window on, a commercial
 * desktop build mounts the workspace only once this device has an active trial
 * or licence, and keeps it mounted until KerfDesk closes (ADR-623). While ADR-623
 * Amendment 3 holds the window off, the workspace mounts at once in KerfDesk Free
 * and a trial or licence unlocks Pro (ADR-540). Builds without a licence adapter,
 * and desktop builds that cannot take a licence, run Free (ADR-540). The browser
 * build's fixed capabilities cannot be unlocked by passing a desktop licence client.
 */
export function EditionProvider({
  client,
  unlicensedRunsFree = UNLICENSED_BUILDS_RUN_FREE,
  licenceWindow = DESKTOP_LICENCE_WINDOW,
  children,
}: {
  readonly client?: LicenceAdapter;
  readonly unlicensedRunsFree?: boolean;
  /** Whether a commercial build opens behind its licence window (ADR-623 Amendment 3). */
  readonly licenceWindow?: boolean;
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
    <LicensedEdition
      client={client}
      unlicensedRunsFree={unlicensedRunsFree}
      licenceWindow={licenceWindow}
    >
      {children}
    </LicensedEdition>
  );
}

function LicensedEdition({
  client,
  unlicensedRunsFree,
  licenceWindow,
  children,
}: {
  readonly client: LicenceAdapter;
  readonly unlicensedRunsFree: boolean;
  readonly licenceWindow: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const session = useLicenceSession(client, unlicensedRunsFree);
  const desktop = useProInDesktop();
  const link = useLicenceLink(client);
  const linkedKey = link.linkedKey ?? '';
  const channel = session.status?.channel;
  // A desktop build without commercial metadata cannot take a licence.
  const freeBuild = unlicensedRunsFree && channel === 'free';
  // Behind the window, nothing mounts until the first status names the build's
  // channel. With the window held off, the workspace mounts at once.
  const gated = !useSessionAdmission(session.status, client, licenceWindow) && channel !== 'free';
  const { load } = session;
  const { showAll } = desktop;
  const { managing, closeManager } = useLicenceManager(
    freeBuild,
    gated,
    session.status !== null,
    linkFulfilled(link.linkedKey, session.status),
    load,
    showAll,
  );
  const value = useEditionValue(session, desktop, freeBuild);
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  const licence = {
    client,
    status: session.status,
    failure: session.failure,
    onStatus: session.accept,
    onRetry: load,
  };
  return (
    <EditionContext.Provider value={value}>
      {gated ? (
        <DesktopLicenceGate key={link.serial} initialKey={linkedKey} {...licence} />
      ) : (
        children
      )}
      {managing ? (
        <div role="dialog" aria-modal="false" aria-label="KerfDesk licence" style={panelOverlay}>
          <LicencePanel
            key={link.serial}
            initialKey={linkedKey}
            {...licence}
            onClose={closeManager}
          />
        </div>
      ) : null}
      {managing || gated ? null : (
        <PendingProDialog client={client} session={session} freeBuild={freeBuild} />
      )}
      {desktop.shown === null ? null : (
        <ProInDesktopDialog feature={desktop.shown} onClose={desktop.close} />
      )}
      <CommercialUpdates client={client} updatesUntil={session.status?.updatesUntil ?? null} />
    </EditionContext.Provider>
  );
}

/** The edition the app reads, rebuilt only when what it reports changes. */
function useEditionValue(
  session: ReturnType<typeof useLicenceSession>,
  desktop: ReturnType<typeof useProInDesktop>,
  freeBuild: boolean,
): EditionValue {
  const { status, isPro, hasPendingPro, requestPro } = session;
  const { showAll, request } = desktop;
  return useMemo<EditionValue>(
    () => ({
      status,
      licensed: status?.channel === 'commercial',
      // Store mutations must also check elapsed time when browser timers slept.
      get pro() {
        return isPro();
      },
      proInDesktop: freeBuild,
      // Only the licence prompt keeps an edit it can still run. A free build
      // cannot unlock Pro, so its desktop notice holds none (ADR-609).
      get proPromptOpen() {
        return !freeBuild && hasPendingPro();
      },
      requestPro: freeBuild ? request : requestPro,
      openLicence: freeBuild ? showAll : openLicence,
    }),
    [freeBuild, hasPendingPro, isPro, request, requestPro, status, showAll],
  );
}

/** The Pro tool waiting on a licence, explained the way this build can unlock it. */
function PendingProDialog({
  client,
  session,
  freeBuild,
}: {
  readonly client: LicenceAdapter;
  readonly session: ReturnType<typeof useLicenceSession>;
  readonly freeBuild: boolean;
}): JSX.Element | null {
  const { pending, settle } = session;
  if (pending === null) return null;
  const close = (): void => settle(null);
  return freeBuild ? (
    <ProInDesktopDialog feature={pending.feature} onClose={close} />
  ) : (
    <ProFeatureDialog
      feature={pending.feature}
      client={client}
      status={session.status}
      onStatus={session.accept}
      onClose={close}
    />
  );
}

/**
 * Lets the workspace in the first time this session reports Pro, and keeps it
 * in until KerfDesk closes: a licence change never unmounts a running job or an
 * open project (ADR-623). The main process remembers that the app session was
 * let in, so a renderer reloaded after a crash, or a reopened macOS window,
 * reaches its workspace and job recovery even after rights ended (ADR-623
 * Amendment 1). With the licence window held off, the workspace is in from the
 * start, in Free or Pro, and acknowledges its first status (ADR-623 Amendment 3).
 */
function useSessionAdmission(
  status: LicenceStatus | null,
  client: LicenceAdapter,
  licenceWindow: boolean,
): boolean {
  const [admitted, setAdmitted] = useState(!licenceWindow);
  const acknowledged = useRef<number | null>(null);
  const admits = !licenceWindow || status?.edition === 'pro' || status?.sessionAdmitted === true;
  if (!admitted && admits) setAdmitted(true);
  useEffect(() => {
    const generation = status?.admissionGeneration;
    if (!admitted || generation === undefined || acknowledged.current === generation) return;
    acknowledged.current = generation;
    void client.workspaceAdmitted?.(generation).catch(() => {
      acknowledged.current = null;
    });
  }, [admitted, client, status]);
  return admitted || admits;
}

/**
 * Help > Licence opens the Licence panel; a free build has none to manage, and
 * the window the desktop app opens behind already is one (ADR-623).
 */
/** The window was opened with the linked key itself: the link has done its job. */
function linkFulfilled(linkedKey: string | null, status: LicenceStatus | null): boolean {
  return linkedKey !== null && status?.licenseKey === linkedKey;
}

function useLicenceManager(
  freeBuild: boolean,
  gated: boolean,
  statusKnown: boolean,
  linkFulfilled: boolean,
  load: () => Promise<void>,
  showProInDesktop: () => void,
): { readonly managing: boolean; readonly closeManager: () => void } {
  const [managing, setManaging] = useState(false);
  // A purchase link that arrives before the first status, or while the licence
  // window shows its key, opens Help > Licence once the workspace is let in.
  const [deferred, setDeferred] = useState(false);
  const manage = useCallback((): void => {
    if (freeBuild) {
      showProInDesktop();
      return;
    }
    if (gated) setDeferred(true);
    else setManaging(true);
    void load();
  }, [freeBuild, gated, load, showProInDesktop]);
  useEffect(() => {
    if (!deferred || !statusKnown) return;
    if (freeBuild) {
      setDeferred(false);
      showProInDesktop();
      return;
    }
    // Behind the licence window, which shows the linked key, wait for admission.
    if (gated) return;
    setDeferred(false);
    if (!linkFulfilled) setManaging(true);
  }, [deferred, freeBuild, gated, linkFulfilled, showProInDesktop, statusKnown]);
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

/** Re-read the local licence status on a timer, on focus and after a quiet check. */
function useLicenceStatusPolling(load: () => Promise<void>): void {
  useEffect(() => {
    void load();
    // Reads the main process's local status, not the network. Its quiet checks
    // can revoke rights or pause a trial between panel visits (ADR-592).
    const timer = window.setInterval(() => void load(), 30_000);
    const checkVisible = (): void => {
      if (document.visibilityState !== 'hidden') void load();
    };
    // A quiet confirmation that just finished may open the licence window (ADR-623).
    const refreshed = (): void => void load();
    window.addEventListener('focus', checkVisible);
    window.addEventListener(LICENCE_REFRESHED_EVENT, refreshed);
    document.addEventListener('visibilitychange', checkVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkVisible);
      window.removeEventListener(LICENCE_REFRESHED_EVENT, refreshed);
      document.removeEventListener('visibilitychange', checkVisible);
    };
  }, [load]);
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
  useLicenceStatusPolling(load);
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
  const hasPendingPro = useCallback(() => pendingRef.current !== null, []);
  return { status, failure, pending, settle, accept, load, requestPro, isPro, hasPendingPro };
}
