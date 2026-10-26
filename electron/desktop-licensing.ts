import { app, BrowserWindow, clipboard, net, Notification, safeStorage, shell } from 'electron';
import { installLicenceLink } from './licence-link.js';
import { readLicensingConfig, type LicensingConfig } from './licensing-config.js';
import { isLicenceCheckoutUrl, purchasePageUrl } from './licensing-commerce.js';
import { licensingDeviceId, licensingHardwareId, rememberDeviceId } from './licensing-device.js';
import {
  withLicensingRoutes,
  type LicenceEntry,
  type ProtocolHandler,
  type RequestUpdateClose,
} from './licensing-routes.js';
import { createLicensingStore } from './licensing-store.js';
import { createLicensingRuntime, type LicensingRuntime } from './licensing-runtime.js';
import { scheduleLicenceChecks } from './licensing-schedule.js';
import { createStartupSignals, servicesAlwaysAdmitted } from './licensing-startup-signals.js';
import {
  checkCommercialUpdates,
  commercialUpdatesOffered,
  type CommercialUpdater,
} from './commercial-update.js';
import {
  createUpdateRingStore,
  earlyUpdateSetting,
  type UpdateRingStore,
} from './update-ring-store.js';
import { createDesktopUpdates, type DesktopUpdates } from './update-status.js';
import { desktopManualUpdates } from './desktop-manual-updates.js';
import { installManualUpdateQuit } from './manual-update-quit.js';
import { createProjectSealKey } from './project-seal-key.js';
import { officialPlatformDownloadUrl } from './official-download-page.js';

// A plain label for the device list; the computer's own name is never sent.
// The startup licence confirmation waits this long for the renderer's first
// status read before running anyway (ADR-623).
export const FIRST_STATUS_GRACE_MS = 10_000;

const DEVICE_NAMES: Readonly<Record<string, string>> = {
  win32: 'Windows computer',
  darwin: 'Mac',
  linux: 'Linux computer',
};

/** Fixed, data-free signal: the renderer reads the refreshed status itself (ADR-623). */
export const LICENCE_REFRESHED_SIGNAL =
  "window.dispatchEvent(new CustomEvent('kerfdesk:licence-refreshed')); undefined";

/**
 * A quiet confirmation can turn an overdue check-in back into a licence, so the
 * licence window, or Help > Licence, reads the status again at once.
 */
function announceLicenceRefresh(): void {
  try {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || !isAppRenderer(window.webContents.getURL())) continue;
      void window.webContents.executeJavaScript(LICENCE_REFRESHED_SIGNAL).catch(() => undefined);
    }
  } catch {
    // Only a convenience: the renderer also rereads its status every 30 seconds.
  }
}

// A packaged build only ever shows its own app://app renderer.
function isAppRenderer(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'app:' && parsed.host === 'app';
  } catch {
    return false;
  }
}

function announceDownloadedUpdate(version: string): void {
  if (Notification.isSupported())
    new Notification({
      title: 'KerfDesk update ready',
      body: `KerfDesk ${version} has downloaded and will install when you close KerfDesk.`,
    }).show();
}

/** The only two pages licensing ever opens in the browser: a saved checkout, and the purchase page. */
function browserOpeners(sandbox: boolean) {
  return {
    openCheckout: async (url: string) => {
      if (!isLicenceCheckoutUrl(url, sandbox)) throw new Error('Invalid checkout destination');
      await shell.openExternal(url);
    },
    openPurchasePage: async (url: string) => {
      if (url !== purchasePageUrl(sandbox)) throw new Error('Invalid purchase page');
      await shell.openExternal(url);
    },
  };
}

type Options = {
  readonly appPath: string;
  readonly userDataPath: string;
  readonly version: string;
  readonly packaged: boolean;
  readonly trustedUpdates: boolean;
  readonly updater: CommercialUpdater;
  readonly canInstallManualUpdate?: () => boolean;
  readonly requestManualUpdateClose?: RequestUpdateClose;
};

export function createDesktopLicensing(options: Options) {
  const config = readLicensingConfig(options.appPath);
  let pendingUpdate: { envelope: unknown; version: string } | null = null;
  let stopChecks: (() => void) | null = null;
  const runtime = createLicensingRuntime({
    config,
    currentVersion: options.version,
    store: createLicensingStore({
      userDataPath: options.userDataPath,
      secureStorage: safeStorage,
      platform: process.platform,
      sandbox: config.channel === 'commercial' && config.sandbox === true,
    }),
    // reg.exe runs once per process, not on every licence read (ADR-523 Amendment 2).
    deviceId: rememberDeviceId(() => licensingDeviceId()),
    hardwareId: () => licensingHardwareId(),
    deviceName: DEVICE_NAMES[process.platform] ?? 'KerfDesk device',
    fetch: (url, init) => net.fetch(url, init),
    ...browserOpeners(config.channel === 'commercial' && config.sandbox === true),
  });
  // What the licence window is sent decides when desktop services start (ADR-623).
  // While Amendment 3 holds the window off, they start with the app.
  const signals = createStartupSignals(servicesAlwaysAdmitted(config.channel));
  const entry = {
    ...licenceEntry(config, desktopLicenceLink(config, options.packaged), options),
    observeRequest: signals.observeRequest,
    admitWorkspace: signals.admitWorkspace,
    sessionAdmitted: signals.sessionAdmitted,
  };
  const rings = createUpdateRingStore(options.userDataPath);
  const { manual, installer } = manualUpdateChecks(config, options, runtime);
  /** Beta remains exclusive to the trusted signed updater (ADR-541). */
  const earlyUpdates = earlyUpdateSetting(
    config.channel === 'commercial' && options.trustedUpdates,
    rings,
  );
  const updates =
    manual ??
    commercialUpdates(options, config, runtime, rings, (envelope, version) => {
      pendingUpdate = { envelope, version };
      announceDownloadedUpdate(version);
    });
  return {
    runtime,
    config,
    updates,
    /** Whether a workspace is admitted past the licence window (ADR-623). */
    admission: signals.admission,
    /** The licensing and update routes in front of the app's own files. */
    routes: (fallback: ProtocolHandler): ProtocolHandler =>
      withLicensingRoutes(
        fallback,
        runtime,
        earlyUpdates,
        updates,
        installer === null ? undefined : options.requestManualUpdateClose,
        entry,
      ),
    /**
     * Runs once the window is open: a quiet licence confirmation (a trial daily, paid rights weekly), then
     * the update check. Neither holds the licence window: the confirmation
     * starts once the renderer has read the saved status (ADR-623).
     * Licence confirmation and manual release discovery repeat every 30 minutes.
     */
    start: (): void => {
      if (config.channel !== 'commercial' || stopChecks !== null) return;
      void signals
        .afterFirstStatusRead(FIRST_STATUS_GRACE_MS)
        .then(() => runtime.refreshInBackground())
        .catch(() => undefined)
        .then(() => {
          announceLicenceRefresh();
          updates.check();
        });
      stopChecks = scheduleLicenceChecks(async () => {
        await runtime.refreshInBackground().catch(() => undefined);
        announceLicenceRefresh();
        manual?.check();
      });
      app.once('will-quit', () => stopChecks?.());
    },
    prepareQuit: () => {
      if (config.channel !== 'commercial' || config.manualUpdates === true) return;
      options.updater.autoInstallOnAppQuit =
        pendingUpdate !== null &&
        runtime.isReleaseEligibleCached(pendingUpdate.envelope, pendingUpdate.version);
    },
  };
}

/** Key entry helpers and the project seal key, for a commercial build only (ADR-579, ADR-592). */
function licenceEntry(
  config: LicensingConfig,
  licenceLink: ReturnType<typeof desktopLicenceLink>,
  options: Pick<Options, 'userDataPath'>,
): LicenceEntry {
  if (config.channel !== 'commercial') return {};
  return {
    readClipboard: () => clipboard.readText(),
    licenceLink,
    projectSealKey: createProjectSealKey({
      userDataPath: options.userDataPath,
      secureStorage: safeStorage,
    }),
  };
}

/** kerfdesk://licence for a packaged, non-sandbox commercial Windows build only (ADR-579). */
function desktopLicenceLink(config: LicensingConfig, packaged: boolean) {
  return installLicenceLink(app, {
    enabled:
      config.channel === 'commercial' &&
      config.sandbox !== true &&
      packaged &&
      process.platform === 'win32',
    argv: process.argv,
    readClipboard: () => clipboard.readText(),
    primaryWindow: () => BrowserWindow.getAllWindows()[0],
    isTrustedRenderer: isAppRenderer,
  });
}

/**
 * The unsigned build's own update checks (ADR-561, ADR-613). Only the Windows
 * installer runs after a close; macOS and Linux open the download page.
 */
function manualUpdateChecks(config: LicensingConfig, options: Options, runtime: LicensingRuntime) {
  const checks = desktopManualUpdates(config, {
    ...options,
    fetch: (url, init) => net.fetch(url, init),
    eligible: runtime.isManualReleaseEligible,
    announce: announceManualUpdate,
    announceDownloadPage: announceDownloadPageUpdate,
    openDownloadPage: openPlatformDownloadPage,
  });
  const installer = checks?.kind === 'installer' ? checks.updates : null;
  if (installer !== null)
    installManualUpdateQuit(app, installer, {
      canInstall: options.canInstallManualUpdate ?? (() => false),
      reportFailure: (error) => console.warn('Manual update installation deferred:', error),
    });
  return { manual: checks?.updates ?? null, installer };
}

/** The only pages a macOS or Linux update opens: one verified version's section (ADR-613). */
async function openPlatformDownloadPage(url: string): Promise<void> {
  const page = new URL(url);
  const version = page.searchParams.get('version') ?? '';
  const platform = page.hash.slice(1);
  if (
    (platform !== 'macos' && platform !== 'linux') ||
    url !== officialPlatformDownloadUrl(version, platform)
  )
    throw new Error('Invalid download page');
  await shell.openExternal(url);
}

function announceDownloadPageUpdate(version: string): void {
  if (Notification.isSupported())
    new Notification({
      title: 'KerfDesk update available',
      body: `KerfDesk ${version} is available. Open Help > Check for Updates to get it from the download page, then install it after you close KerfDesk.`,
    }).show();
}

function announceManualUpdate(version: string): void {
  if (Notification.isSupported())
    new Notification({
      title: 'KerfDesk update available',
      body: `KerfDesk ${version} is available. Open Help > Check for Updates to download it. Installation starts only after you choose it and close KerfDesk.`,
    }).show();
}

/**
 * The update status Help > Check for Updates shows (ADR-547). Only a trusted,
 * packaged commercial Windows build checks; every other build reports that it
 * does not update itself.
 */
function commercialUpdates(
  options: Options,
  config: LicensingConfig,
  runtime: LicensingRuntime,
  rings: UpdateRingStore,
  onVerifiedDownload: (envelope: unknown, version: string) => void,
): DesktopUpdates {
  const build = {
    isPackaged: options.packaged,
    isChannelTrusted: options.trustedUpdates,
    platform: process.platform,
    currentVersion: options.version,
  };
  return createDesktopUpdates({
    offered: config.channel === 'commercial' && commercialUpdatesOffered(build),
    currentVersion: options.version,
    run: async (onDownloading) => {
      try {
        return await checkCommercialUpdates(options.updater, {
          ...build,
          releaseKeys: config.channel === 'commercial' ? config.releaseKeys : {},
          fetch: (url, init) => net.fetch(url, init),
          isEligible: runtime.isReleaseEligible,
          isEligibleCached: runtime.isReleaseEligibleCached,
          ring: await rings.read(),
          onDownloading,
          onVerifiedDownload,
        });
      } catch (error) {
        console.warn('Commercial update check could not complete:', error);
        throw error;
      }
    },
  });
}
