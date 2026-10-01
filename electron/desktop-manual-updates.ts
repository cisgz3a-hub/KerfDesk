import type { LicensingConfig } from './licensing-config.js';
import { verifyLicenceRelease } from './licensing-verification.js';
import {
  manualUpdatesOffered,
  pinnedStableReleaseKeys,
  type UpdateFetch,
} from './manual-update-manifest.js';
import { createManualUpdates, type ManualUpdates } from './manual-update.js';

export function desktopManualUpdates(
  config: LicensingConfig,
  options: {
    readonly packaged: boolean;
    readonly version: string;
    readonly userDataPath: string;
    readonly fetch: UpdateFetch;
    readonly eligible: (envelope: string, version: string) => Promise<boolean>;
    readonly announce: (version: string) => void;
  },
): ManualUpdates | null {
  if (config.channel !== 'commercial' || config.manualUpdates !== true) return null;
  try {
    const keys = pinnedStableReleaseKeys();
    if (
      !manualUpdatesOffered(
        config,
        { ...options, platform: process.platform, arch: process.arch },
        keys,
      )
    )
      return null;
    const release = verifyLicenceRelease(config.release, keys);
    if (release === null) return null;
    return createManualUpdates({
      currentVersion: options.version,
      currentPublishedAt: release.publishedAt * 1000,
      userDataPath: options.userDataPath,
      keys,
      fetch: options.fetch,
      eligible: options.eligible,
      announce: options.announce,
    });
  } catch {
    return null;
  }
}
