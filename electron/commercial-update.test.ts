import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { checkCommercialUpdates, commercialUpdateCandidate } from './commercial-update.js';

const pair = generateKeyPairSync('ed25519');
const keys = { stable: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const now = Date.parse('2026-09-28T12:00:00.000Z');
const hash = Buffer.alloc(64, 7).toString('base64');
function manifest(
  version = '1.2.0',
  publishedAt = '2026-09-20T12:00:00.000Z',
  kind = 'update-manifest',
) {
  const name = `KerfDesk-${version}-windows-x64-setup.exe`;
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind,
      channel: 'stable',
      version,
      sourceSha: 'a'.repeat(40),
      sourceRef: `refs/tags/v${version}`,
      publishedAt,
      artifacts: [name, `${name}.blockmap`, 'latest.yml'].map((name) => ({
        name,
        bytes: 1234,
        sha256: 'b'.repeat(64),
        sha512: hash,
      })),
    }),
  );
  return {
    schemaVersion: 1,
    keyId: 'stable',
    algorithm: 'Ed25519',
    payload: payload.toString('base64'),
    signature: sign(null, payload, pair.privateKey).toString('base64'),
  };
}
function feed(version = '1.2.0') {
  const name = `KerfDesk-${version}-windows-x64-setup.exe`;
  return { version, path: name, sha512: hash, files: [{ url: name, size: 1234, sha512: hash }] };
}
function fixture(releases: unknown[] = [manifest()]) {
  const events = new EventEmitter();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableWebInstaller: false,
    disableDifferentialDownload: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: feed() })),
    on: (event: string, listener: (info: unknown) => void) => events.on(event, listener),
    removeListener: (event: string, listener: (info: unknown) => void) =>
      events.removeListener(event, listener),
    downloadUpdate: vi.fn(async () => {
      events.emit('update-downloaded', feed());
      return ['installer.exe'];
    }),
  };
  const options = {
    isPackaged: true,
    isChannelTrusted: true,
    platform: 'win32',
    currentVersion: '1.0.0',
    releaseKeys: keys,
    fetch: vi.fn(async () => Response.json({ schemaVersion: 1, releases })),
    isEligible: vi.fn(async (_envelope: unknown, _version: string) => true),
    isEligibleCached: vi.fn(() => true),
    now: () => now,
  };
  return { updater, options, events };
}
describe('commercial signed and licence-aware updates', () => {
  it('downloads only after signed artifact and entitlement checks', async () => {
    const { updater, options } = fixture();
    await checkCommercialUpdates(updater, options);
    expect(updater.autoDownload).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://dl.kerfdesk.com/desktop/commercial/releases/1.2.0',
    });
    expect(options.isEligible).toHaveBeenCalledTimes(3);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });
  it('finds an older eligible update without upgrading beyond purchased coverage', async () => {
    const { updater, options } = fixture([manifest('1.3.0'), manifest('1.2.0')]);
    options.isEligible.mockImplementation(async (_value, version) => version === '1.2.0');
    await checkCommercialUpdates(updater, options);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.setFeedURL.mock.calls[0]?.[0].url).toContain('/1.2.0');
  });
  it.each([false, true])(
    'leaves untrusted or unpackaged installs untouched (%s)',
    async (packaged) => {
      const { updater, options } = fixture();
      await checkCommercialUpdates(updater, {
        ...options,
        isPackaged: packaged,
        isChannelTrusted: !packaged,
      });
      expect(options.fetch).not.toHaveBeenCalled();
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    },
  );
  it('rejects tampering, future dates and a build identity masquerading as an update', () => {
    expect(
      commercialUpdateCandidate(
        { ...manifest(), signature: Buffer.alloc(64).toString('base64') },
        keys,
        now,
      ),
    ).toBeNull();
    expect(
      commercialUpdateCandidate(manifest('1.2.0', '2027-01-01T00:00:00.000Z'), keys, now),
    ).toBeNull();
    expect(
      commercialUpdateCandidate(manifest('1.2.0', undefined, 'release-identity'), keys, now),
    ).toBeNull();
  });
  it('never installs an ambiguous duplicate version or an unsigned entry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const releases of [[manifest(), manifest()], [{}]]) {
      const { updater, options } = fixture(releases);
      await checkCommercialUpdates(updater, options);
      expect(updater.setFeedURL).not.toHaveBeenCalled();
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });
  it('skips one damaged or future-dated entry instead of stopping every update', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const damaged = { ...manifest('1.4.0'), signature: Buffer.alloc(64).toString('base64') };
    const future = manifest('1.3.0', '2027-01-01T00:00:00.000Z');
    const { updater, options } = fixture([damaged, future, {}, manifest('1.2.0')]);
    await checkCommercialUpdates(updater, options);
    expect(updater.setFeedURL).toHaveBeenCalledExactlyOnceWith({
      provider: 'generic',
      url: 'https://dl.kerfdesk.com/desktop/commercial/releases/1.2.0',
    });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Skipped 3 unverifiable update catalogue entries.');
    warn.mockRestore();
  });
  it.each(['url', 'hash', 'size', 'version', 'web-installer', 'elevation'])(
    'rejects substituted feed %s',
    async (field) => {
      const { updater, options } = fixture();
      const info = feed();
      if (field === 'url') info.files[0]!.url = 'https://attacker.invalid/setup.exe';
      if (field === 'hash') info.files[0]!.sha512 = Buffer.alloc(64, 8).toString('base64');
      if (field === 'size') info.files[0]!.size = 1235;
      if (field === 'version') info.version = '1.3.0';
      if (field === 'elevation') Object.assign(info.files[0]!, { isAdminRightsRequired: true });
      updater.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: field === 'web-installer' ? { ...info, packages: {} } : info,
      });
      await expect(checkCommercialUpdates(updater, options)).rejects.toThrow('does not match');
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    },
  );
  it('rechecks a changed licence before downloading', async () => {
    const { updater, options } = fixture();
    options.isEligible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await checkCommercialUpdates(updater, options);
    expect(updater.checkForUpdates).toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
  it('never downgrades or reinstalls current versions', async () => {
    const { updater, options } = fixture([manifest('1.0.0'), manifest('0.9.0')]);
    await checkCommercialUpdates(updater, options);
    expect(updater.setFeedURL).not.toHaveBeenCalled();
  });
  it('honours updater OS and staged rollout availability checks', async () => {
    const { updater, options } = fixture();
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: feed() });
    await checkCommercialUpdates(updater, options);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
  it('does not arm installation if rights change during a download', async () => {
    const { updater, options } = fixture();
    options.isEligible
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await checkCommercialUpdates(updater, options);
    expect(updater.downloadUpdate).toHaveBeenCalled();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
  it('reads the beta catalogue only on a device that asked for early versions (ADR-541)', async () => {
    const stable = fixture();
    await checkCommercialUpdates(stable.updater, stable.options);
    const beta = fixture([manifest('1.3.0', '2026-09-27T07:17:00.000Z', 'update-manifest')]);
    beta.updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: feed('1.3.0'),
    });
    beta.updater.downloadUpdate.mockImplementation(async () => {
      beta.events.emit('update-downloaded', feed('1.3.0'));
      return ['installer.exe'];
    });
    await checkCommercialUpdates(beta.updater, { ...beta.options, ring: 'beta' });
    expect(stable.options.fetch.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'https://dl.kerfdesk.com/desktop/commercial/catalog.json',
    ]);
    expect(beta.options.fetch.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'https://dl.kerfdesk.com/desktop/commercial/beta/catalog.json',
    ]);
    // Both rings point at the same release files; only the list differs.
    expect(beta.updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://dl.kerfdesk.com/desktop/commercial/releases/1.3.0',
    });
    expect(beta.updater.autoInstallOnAppQuit).toBe(true);
  });
  it('bounds chunked untrusted catalog bodies', async () => {
    const { updater, options } = fixture();
    options.fetch.mockResolvedValue(new Response(new Uint8Array(256 * 1024 + 1)));
    await expect(checkCommercialUpdates(updater, options)).rejects.toThrow('too large');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it('rejects a mismatched downloaded event and removes its listener', async () => {
    const { updater, options, events } = fixture();
    updater.downloadUpdate.mockImplementation(async () => {
      events.emit('update-downloaded', feed('1.3.0'));
      return ['wrong.exe'];
    });
    await checkCommercialUpdates(updater, options);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(events.listenerCount('update-downloaded')).toBe(0);
  });
  it('reports what each check found (ADR-547)', async () => {
    const ready = fixture();
    const onDownloading = vi.fn();
    expect(
      await checkCommercialUpdates(ready.updater, { ...ready.options, onDownloading }),
    ).toEqual({ kind: 'ready', version: '1.2.0' });
    expect(onDownloading).toHaveBeenCalledWith('1.2.0');

    const current = fixture([manifest('1.0.0')]);
    expect(await checkCommercialUpdates(current.updater, current.options)).toEqual({
      kind: 'up-to-date',
    });
    const unpackaged = fixture();
    expect(
      await checkCommercialUpdates(unpackaged.updater, {
        ...unpackaged.options,
        isPackaged: false,
      }),
    ).toEqual({ kind: 'not-offered' });
  });
  it('names the newest release a licence does not cover, or a download that will not install', async () => {
    const uncovered = fixture([manifest('1.3.0'), manifest('1.2.0')]);
    uncovered.options.isEligible.mockResolvedValue(false);
    expect(await checkCommercialUpdates(uncovered.updater, uncovered.options)).toEqual({
      kind: 'not-covered',
      version: '1.3.0',
    });
    const changed = fixture();
    changed.options.isEligible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await checkCommercialUpdates(changed.updater, changed.options)).toEqual({
      kind: 'not-covered',
      version: '1.2.0',
    });
    const mismatched = fixture();
    mismatched.updater.downloadUpdate.mockImplementation(async () => {
      mismatched.events.emit('update-downloaded', feed('1.3.0'));
      return ['wrong.exe'];
    });
    expect(await checkCommercialUpdates(mismatched.updater, mismatched.options)).toEqual({
      kind: 'not-installed',
      version: '1.2.0',
    });
  });
  it('cleans the listener and disarms on download failure', async () => {
    const { updater, options, events } = fixture();
    updater.downloadUpdate.mockRejectedValue(new Error('download failed'));
    await expect(checkCommercialUpdates(updater, options)).rejects.toThrow('download failed');
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(events.listenerCount('update-downloaded')).toBe(0);
  });
});
