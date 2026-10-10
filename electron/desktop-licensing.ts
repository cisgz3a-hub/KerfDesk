import { app, BrowserWindow, clipboard, net, Notification, safeStorage, shell } from 'electron';
import { installLicenceLink } from './licence-link.js';
import { readLicensingConfig, type LicensingConfig } from './licensing-config.js';
import { isLicenceCheckoutUrl, purchasePageUrl } from './licensing-commerce.js';
import { licensingDeviceId, rememberDeviceId } from './licensing-device.js';
import {
  withLicensingRoutes,
  type ProtocolHandler,
  type RequestUpdateClose,
} from './licensing-routes.js';
import { createLicensingStore } from './licensing-store.js';
import { createLicensingRuntime, type LicensingRuntime } from './licensing-runtime.js';
import { scheduleLicenceChecks } from './licensing-schedule.js';
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

// A plain label for the device list; the computer's own name is never sent.
const DEVICE_NAMES: Readonly<Record<string, string>> = {
  win32: 'Windows computer',
  darwin: 'Mac',
  linux: 'Linux computer',
};

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
    deviceName: DEVICE_NAMES[process.platform] ?? 'KerfDesk device',
    fetch: (url, init) => net.fetch(url, init),
    ...browserOpeners(config.channel === 'commercial' && config.sandbox === true),
  });
  const licenceLink = desktopLicenceLink(config, options.packaged);
  const rings = createUpdateRingStore(options.userDataPath);
  const manual = desktopManualUpdates(config, {
    ...options,
    fetch: (url, init) => net.fetch(url, init),
    eligible: runtime.isManualReleaseEligible,
    announce: announceManualUpdate,
  });
  if (manual !== null)
    installManualUpdateQuit(app, manual, {
      canInstall: options.canInstallManualUpdate ?? (() => false),
      reportFailure: (error) => console.warn('Manual update installation deferred:', error),
    });
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
    /** The licensing and update routes in front of the app's own files. */
    routes: (fallback: ProtocolHandler): ProtocolHandler =>
      withLicensingRoutes(
        fallback,
        runtime,
        earlyUpdates,
        updates,
        manual === null ? undefined : options.requestManualUpdateClose,
        config.channel === 'commercial'
          ? { readClipboard: () => clipboard.readText(), licenceLink }
          : {},
      ),
    /**
     * Runs once the window is open: a quiet weekly licence confirmation, then
     * the update check. The workspace never waits for either (ADR-540).
     * Licence confirmation and manual release discovery repeat every 30 minutes.
     */
    start: (): void => {
      if (config.channel !== 'commercial' || stopChecks !== null) return;
      void runtime
        .refreshInBackground()
        .catch(() => undefined)
        .then(() => {
          updates.check();
        });
      stopChecks = scheduleLicenceChecks(async () => {
        await runtime.refreshInBackground().catch(() => undefined);
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
    // A packaged build only ever shows its own app://app renderer.
    isTrustedRenderer: (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'app:' && parsed.host === 'app';
      } catch {
        return false;
      }
    },
  });
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
