import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  previewUpdateEnabledFromPackageMetadata,
  readDesktopPreviewUpdateEnabled,
  readDesktopUpdateChannelTrust,
  resolveDesktopUpdateModes,
  updateChannelTrustedFromPackageMetadata,
} from './update-channel-trust.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('desktop update-channel trust', () => {
  it('accepts only the exact signed-build boolean', () => {
    expect(updateChannelTrustedFromPackageMetadata({ kerfdeskUpdateChannelTrusted: true })).toBe(
      true,
    );
    expect(updateChannelTrustedFromPackageMetadata({ kerfdeskUpdateChannelTrusted: false })).toBe(
      false,
    );
    expect(updateChannelTrustedFromPackageMetadata({ kerfdeskUpdateChannelTrusted: 'true' })).toBe(
      false,
    );
    expect(updateChannelTrustedFromPackageMetadata(null)).toBe(false);
  });

  it('reads the metadata embedded by the signed package build', () => {
    const appPath = temporaryAppPath({ kerfdeskUpdateChannelTrusted: true });
    expect(readDesktopUpdateChannelTrust(appPath)).toBe(true);
  });

  it('enables notify-only checks only for an exact Preview channel marker', () => {
    expect(
      previewUpdateEnabledFromPackageMetadata({ kerfdeskDesktopReleaseChannel: 'preview' }),
    ).toBe(true);
    expect(
      previewUpdateEnabledFromPackageMetadata({ kerfdeskDesktopReleaseChannel: 'stable' }),
    ).toBe(false);
    expect(previewUpdateEnabledFromPackageMetadata({ kerfdeskDesktopReleaseChannel: true })).toBe(
      false,
    );
    expect(previewUpdateEnabledFromPackageMetadata(null)).toBe(false);
  });

  it('reads the Preview marker independently from signed update trust', () => {
    const appPath = temporaryAppPath({
      kerfdeskDesktopReleaseChannel: 'preview',
      kerfdeskUpdateChannelTrusted: false,
    });
    expect(readDesktopPreviewUpdateEnabled(appPath)).toBe(true);
    expect(readDesktopUpdateChannelTrust(appPath)).toBe(false);
  });

  it('fails fully closed when Preview and trusted-updater metadata conflict', () => {
    expect(resolveDesktopUpdateModes(true, true)).toEqual({
      trustedUpdater: false,
      previewNotification: false,
    });
    expect(resolveDesktopUpdateModes(true, false)).toEqual({
      trustedUpdater: true,
      previewNotification: false,
    });
    expect(resolveDesktopUpdateModes(false, true)).toEqual({
      trustedUpdater: false,
      previewNotification: true,
    });
  });

  it('fails closed for absent or malformed package metadata', () => {
    const absent = mkdtempSync(join(tmpdir(), 'kerfdesk-update-trust-'));
    temporaryDirectories.push(absent);
    const malformed = mkdtempSync(join(tmpdir(), 'kerfdesk-update-trust-'));
    temporaryDirectories.push(malformed);
    writeFileSync(join(malformed, 'package.json'), '{not-json', 'utf8');

    expect(readDesktopUpdateChannelTrust(absent)).toBe(false);
    expect(readDesktopUpdateChannelTrust(malformed)).toBe(false);
    expect(readDesktopPreviewUpdateEnabled(absent)).toBe(false);
    expect(readDesktopPreviewUpdateEnabled(malformed)).toBe(false);
  });
});

function temporaryAppPath(metadata: Readonly<Record<string, unknown>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'kerfdesk-update-trust-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, 'package.json'), JSON.stringify(metadata), 'utf8');
  return directory;
}
