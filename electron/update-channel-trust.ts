import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageMetadata = {
  readonly kerfdeskUpdateChannelTrusted?: unknown;
};

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
