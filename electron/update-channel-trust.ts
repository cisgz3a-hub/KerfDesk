import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageMetadata = {
  readonly kerfdeskUpdateChannelTrusted?: unknown;
  readonly kerfdeskDesktopReleaseChannel?: unknown;
};

export type DesktopUpdateModes = {
  readonly previewNotification: boolean;
  readonly trustedUpdater: boolean;
};

// Contradictory package metadata fails fully closed. An unsigned Preview can
// notify, or a signed stable package can update, but no package may do both.
export function resolveDesktopUpdateModes(
  trustedUpdater: boolean,
  previewNotification: boolean,
): DesktopUpdateModes {
  return {
    trustedUpdater: trustedUpdater && !previewNotification,
    previewNotification: previewNotification && !trustedUpdater,
  };
}

export function updateChannelTrustedFromPackageMetadata(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PackageMetadata).kerfdeskUpdateChannelTrusted === true
  );
}

export function readDesktopUpdateChannelTrust(appPath: string): boolean {
  try {
    const packageMetadata: unknown = JSON.parse(
      readFileSync(join(appPath, 'package.json'), 'utf8'),
    );
    return updateChannelTrustedFromPackageMetadata(packageMetadata);
  } catch {
    return false;
  }
}

export function previewUpdateEnabledFromPackageMetadata(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PackageMetadata).kerfdeskDesktopReleaseChannel === 'preview'
  );
}

export function readDesktopPreviewUpdateEnabled(appPath: string): boolean {
  try {
    const packageMetadata: unknown = JSON.parse(
      readFileSync(join(appPath, 'package.json'), 'utf8'),
    );
    return previewUpdateEnabledFromPackageMetadata(packageMetadata);
  } catch {
    return false;
  }
}
