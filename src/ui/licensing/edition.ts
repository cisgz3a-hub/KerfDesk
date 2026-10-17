// App-wide edition state. The browser build starts Free even before the React
// provider mounts. Desktop development and isolated component tests can use an
// unrestricted default; shipped builds mount EditionProvider with Free defaults.

import { createContext, useContext } from 'react';
import { BROWSER_FREE_BUILD } from '../../platform/build-capabilities';
import type { LicenceStatus } from '../../platform/types';
import type { ProFeature } from './pro-features';
import { trialHasExpired } from './trial-expiry';

export type EditionValue = {
  readonly status: LicenceStatus | null;
  /** This build sells licences, so it has a Free edition and a Licence panel. */
  readonly licensed: boolean;
  /** Every Pro tool is available right now. */
  readonly pro: boolean;
  /**
   * Runs `onAllowed` now when Pro is available and returns true. Otherwise it
   * explains the Pro tool, offers the trial or a licence, runs `onAllowed` if
   * the operator unlocks Pro from there, and returns false.
   */
  readonly requestPro: (feature: ProFeature, onAllowed?: () => void) => boolean;
  readonly openLicence: () => void;
  /**
   * This build cannot take a licence and runs KerfDesk Free: its Pro tools are
   * in the desktop app (ADR-544), and it says so in the status bar.
   */
  readonly proInDesktop?: boolean;
};

/** Help > Licence asks the edition provider to show the edition this way. */
export const LICENCE_SETTINGS_EVENT = 'kerfdesk:licence-settings';

export const UNRESTRICTED_EDITION: EditionValue = {
  status: null,
  licensed: false,
  pro: true,
  requestPro: (_feature, onAllowed) => {
    onAllowed?.();
    return true;
  },
  openLicence: () => undefined,
};

const BROWSER_FREE_EDITION: EditionValue = {
  status: null,
  licensed: false,
  pro: false,
  proInDesktop: true,
  requestPro: () => false,
  openLicence: () => undefined,
};
const DEFAULT_EDITION = BROWSER_FREE_BUILD ? BROWSER_FREE_EDITION : UNRESTRICTED_EDITION;

export const EditionContext = createContext<EditionValue>(DEFAULT_EDITION);

export function useEdition(): EditionValue {
  return useContext(EditionContext);
}

let fallback: EditionValue = DEFAULT_EDITION;
let active: EditionValue = DEFAULT_EDITION;

let statusKnown: Promise<void> = Promise.resolve();
let markStatusKnown: () => void = () => undefined;

/** EditionProvider publishes itself here for callers outside React. */
export function setActiveEdition(value: EditionValue | null): void {
  active = value ?? fallback;
  if (value !== null && value.status !== null) markStatusKnown();
}

/** How long startup work waits for the first licence status before treating the window as Free. */
export const INITIAL_LICENCE_STATUS_TIMEOUT_MS = 10_000;

/**
 * Resolves once a licensed window has its first licence status, or after a
 * timeout, so startup decisions such as autosave recovery see a paying user's
 * Pro instead of the locked startup edition. Other windows resolve at once.
 */
export function initialLicenceStatus(
  timeoutMs: number = INITIAL_LICENCE_STATUS_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([statusKnown, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A licensed desktop window starts without Pro until its EditionProvider
 * reports, so nothing opened during startup is admitted as Pro (ADR-592).
 */
export function startLicensedEditionLocked(): void {
  statusKnown = new Promise<void>((resolve) => {
    markStatusKnown = resolve;
  });
  fallback = {
    status: null,
    licensed: true,
    pro: false,
    requestPro: () => false,
    openLicence: () => undefined,
  };
  active = fallback;
}

/** The edition this window runs as right now, for callers outside React. */
export function activeEdition(): EditionValue {
  return active;
}

/** The same gate as `useEdition().requestPro`, for command handlers and stores. */
export function requestProFeature(feature: ProFeature, onAllowed?: () => void): boolean {
  return active.requestPro(feature, onAllowed);
}

export function proFeaturesUnlocked(): boolean {
  return active.pro && !trialHasExpired(active.status);
}
