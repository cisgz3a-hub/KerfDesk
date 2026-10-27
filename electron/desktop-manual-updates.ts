import type { LicensingConfig } from './licensing-config.js';
import { verifyLicenceRelease } from './licensing-verification.js';
import {
  manualUpdatePlatform,
  manualUpdatesOffered,
  pinnedStableReleaseKeys,
  type UpdateFetch,
} from './manual-update-manifest.js';
import { createManualUpdates, type ManualUpdates } from './manual-update.js';
import { createPlatformManualUpdates } from './platform-manual-update.js';
import type { DesktopUpdates } from './update-status.js';

/**
 * The unsigned commercial build's own update checks: the Windows installer
 * service, or on macOS and Linux the download-page notices (ADR-613).
 */
export type DesktopManualUpdates =
  | { readonly kind: 'installer'; readonly updates: ManualUpdates }
  | { readonly kind: 'download-page'; readonly updates: DesktopUpdates };

export function desktopManualUpdates(
  config: LicensingConfig,
  options: {
    readonly packaged: boolean;
    readonly version: string;
    readonly userDataPath: string;
    readonly fetch: UpdateFetch;
    readonly eligible: (envelope: string, version: string) => Promise<boolean>;
    readonly awaitsConfirmation?:
      | ((envelope: string, version: string) => Promise<boolean>)
      | undefined;
    readonly announce: (version: string) => void;
    readonly announceDownloadPage: (version: string) => void;
    readonly openDownloadPage: (url: string) => Promise<void>;
    readonly platform?: string;
    readonly arch?: string;
  },
): DesktopManualUpdates | null {
  if (config.channel !== 'commercial' || config.manualUpdates !== true) return null;
  try {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const keys = pinnedStableReleaseKeys();
    if (!manualUpdatesOffered(config, { ...options, platform, arch }, keys)) return null;
    const release = verifyLicenceRelease(config.release, keys);
    const system = manualUpdatePlatform(platform, arch);
    if (release === null || system === null) return null;
    const current = {
      currentVersion: options.version,
      currentPublishedAt: release.publishedAt * 1000,
      keys,
      fetch: options.fetch,
      eligible: options.eligible,
      awaitsConfirmation: options.awaitsConfirmation,
    };
    if (system === 'windows')
      return {
        kind: 'installer',
        updates: createManualUpdates({
          ...current,
          userDataPath: options.userDataPath,
          announce: options.announce,
        }),
      };
    return {
      kind: 'download-page',
      updates: createPlatformManualUpdates({
        ...current,
        platform: system,
        announce: options.announceDownloadPage,
        openDownloadPage: options.openDownloadPage,
      }),
    };
  } catch {
    return null;
  }
}
