import { app, net, Notification, safeStorage, shell } from 'electron';
import { readLicensingConfig, type LicensingConfig } from './licensing-config.js';
import { isTransactionId } from './licensing-commerce.js';
import { licensingDeviceId, rememberDeviceId } from './licensing-device.js';
import { withLicensingRoutes, type ProtocolHandler } from './licensing-routes.js';
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

type Options = {
  readonly appPath: string;
  readonly userDataPath: string;
  readonly version: string;
  readonly packaged: boolean;
  readonly trustedUpdates: boolean;
  readonly updater: CommercialUpdater;
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
    }),
    // reg.exe runs once per process, not on every licence read (ADR-523 Amendment 2).
    deviceId: rememberDeviceId(() => licensingDeviceId()),
    deviceName: DEVICE_NAMES[process.platform] ?? 'KerfDesk device',
    fetch: (url, init) => net.fetch(url, init),
    openCheckout: async (url) => {
      const target = new URL(url);
      if (
        target.origin !== 'https://kerfdesk.com' ||
        target.pathname !== '/buy.html' ||
        target.username ||
        target.password ||
        target.hash ||
        [...target.searchParams.keys()].join(',') !== '_ptxn' ||
        !isTransactionId(target.searchParams.get('_ptxn') ?? '')
      ) {
        throw new Error('Invalid checkout destination');
      }
      await shell.openExternal(target.href);
    },
  });
  const rings = createUpdateRingStore(options.userDataPath);
  /** Help > Licence's "Get new versions early (beta)" setting (ADR-541). */
  const earlyUpdates = earlyUpdateSetting(config.channel === 'commercial', rings);
  const updates = commercialUpdates(options, config, runtime, rings, (envelope, version) => {
    pendingUpdate = { envelope, version };
    announceDownloadedUpdate(version);
  });
  return {
    runtime,
    config,
    updates,
    /** The licensing and update routes in front of the app's own files. */
    routes: (fallback: ProtocolHandler): ProtocolHandler =>
      withLicensingRoutes(fallback, runtime, earlyUpdates, updates),
    /**
     * Runs once the window is open: a quiet weekly licence confirmation, then
     * the signed update check. The workspace never waits for either (ADR-540).
     * The quiet check then repeats every 30 minutes until KerfDesk quits.
     */
    start: (): void => {
      if (config.channel !== 'commercial' || stopChecks !== null) return;
      void runtime
        .refreshInBackground()
        .catch(() => undefined)
        .then(() => {
          updates.check();
        });
      stopChecks = scheduleLicenceChecks(runtime.refreshInBackground);
      app.once('will-quit', () => stopChecks?.());
    },
    prepareQuit: () => {
      if (config.channel !== 'commercial') return;
      options.updater.autoInstallOnAppQuit =
        pendingUpdate !== null &&
        runtime.isReleaseEligibleCached(pendingUpdate.envelope, pendingUpdate.version);
    },
  };
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
