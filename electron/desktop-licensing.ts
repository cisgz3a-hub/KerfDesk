import { net, Notification, safeStorage, shell } from 'electron';
import { readLicensingConfig } from './licensing-config.js';
import { licensingDeviceId } from './licensing-device.js';
import { createLicensingStore } from './licensing-store.js';
import { createLicensingRuntime } from './licensing-runtime.js';
import { checkCommercialUpdates, type CommercialUpdater } from './commercial-update.js';

// A plain label for the device list; the computer's own name is never sent.
const DEVICE_NAMES: Readonly<Record<string, string>> = {
  win32: 'Windows computer',
  darwin: 'Mac',
  linux: 'Linux computer',
};

export function createDesktopLicensing(options: {
  readonly appPath: string;
  readonly userDataPath: string;
  readonly version: string;
  readonly packaged: boolean;
  readonly trustedUpdates: boolean;
  readonly updater: CommercialUpdater;
}) {
  const config = readLicensingConfig(options.appPath);
  let pendingUpdate: { envelope: unknown; version: string } | null = null;
  const runtime = createLicensingRuntime({
    config,
    currentVersion: options.version,
    store: createLicensingStore({
      userDataPath: options.userDataPath,
      secureStorage: safeStorage,
      platform: process.platform,
    }),
    deviceId: licensingDeviceId,
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
        !/^txn_[a-z0-9]{26}$/.test(target.searchParams.get('_ptxn') ?? '')
      ) {
        throw new Error('Invalid checkout destination');
      }
      await shell.openExternal(target.href);
    },
  });
  const checkUpdates = (): Promise<void> =>
    checkCommercialUpdates(options.updater, {
      isPackaged: options.packaged,
      isChannelTrusted: options.trustedUpdates,
      platform: process.platform,
      currentVersion: options.version,
      releaseKeys: config.channel === 'commercial' ? config.releaseKeys : {},
      fetch: (url, init) => net.fetch(url, init),
      isEligible: runtime.isReleaseEligible,
      isEligibleCached: runtime.isReleaseEligibleCached,
      onVerifiedDownload: (envelope, version) => {
        pendingUpdate = { envelope, version };
        if (Notification.isSupported())
          new Notification({
            title: 'KerfDesk update ready',
            body: `KerfDesk ${version} has downloaded and will install when you close KerfDesk.`,
          }).show();
      },
    }).catch(() => console.warn('Commercial update check could not complete.'));
  return {
    runtime,
    config,
    /**
     * Runs once the window is open: a quiet weekly licence confirmation, then
     * the signed update check. The workspace never waits for either (ADR-540).
     */
    start: (): void => {
      if (config.channel !== 'commercial') return;
      void runtime
        .refreshInBackground()
        .catch(() => undefined)
        .then(checkUpdates);
    },
    prepareQuit: () => {
      if (config.channel !== 'commercial') return;
      options.updater.autoInstallOnAppQuit =
        pendingUpdate !== null &&
        runtime.isReleaseEligibleCached(pendingUpdate.envelope, pendingUpdate.version);
    },
  };
}
