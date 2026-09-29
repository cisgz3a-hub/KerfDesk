// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NsisUpdater } from 'electron-updater';
import { AppUpdater } from 'electron-updater/out/AppUpdater.js';
import { checkCommercialUpdates } from './commercial-update.js';

const pair = generateKeyPairSync('ed25519');
const keys = { stable: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const hash = Buffer.alloc(64, 7).toString('base64');
const name = 'KerfDesk-1.2.0-windows-x64-setup.exe';
const feed = {
  version: '1.2.0',
  path: name,
  sha512: hash,
  files: [{ url: name, size: 1234, sha512: hash }],
};
const payload = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'update-manifest',
    channel: 'stable',
    version: '1.2.0',
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/tags/v1.2.0',
    publishedAt: '2026-01-01T00:00:00.000Z',
    artifacts: [name, `${name}.blockmap`, 'latest.yml'].map((name) => ({
      name,
      bytes: 1234,
      sha256: 'b'.repeat(64),
      sha512: hash,
    })),
  }),
);
const envelope = {
  schemaVersion: 1,
  keyId: 'stable',
  algorithm: 'Ed25519',
  payload: payload.toString('base64'),
  signature: sign(null, payload, pair.privateKey).toString('base64'),
};

type DownloadTask = { done: (event: unknown) => Promise<void> };
function fixture({ eligibleOnEvent = true, eligibleAfterDownload = true, available = true } = {}) {
  const quitHandlers: Array<(exitCode: number) => void> = [];
  const updater = new NsisUpdater(null, {
    version: '1.0.0',
    name: 'KerfDesk',
    isPackaged: true,
    // No real profile, filesystem, network or installer is used: only the
    // injected adapter and the real updater event/check/download orchestration.
    appUpdateConfigPath: 'unused',
    userDataPath: 'unused',
    baseCachePath: 'unused',
    whenReady: async () => undefined,
    relaunch: vi.fn(),
    quit: vi.fn(),
    onQuit: (handler) => {
      quitHandlers.push(handler);
    },
  });
  updater.logger = null;
  updater.isUpdateSupported = () => available;
  updater.isUserWithinRollout = () => true;
  const provider = {
    resolveFiles: () => [
      {
        url: new URL(`https://dl.kerfdesk.com/desktop/commercial/releases/1.2.0/${name}`),
        info: feed.files[0],
      },
    ],
  };
  vi.spyOn(
    updater as unknown as { getUpdateInfoAndProvider: () => Promise<unknown> },
    'getUpdateInfoAndProvider',
  ).mockResolvedValue({ info: feed, provider });
  const options = {
    isPackaged: true,
    isChannelTrusted: true,
    platform: 'win32',
    currentVersion: '1.0.0',
    releaseKeys: keys,
    fetch: vi.fn(async () => Response.json({ schemaVersion: 1, releases: [envelope] })),
    isEligible: vi.fn(async () => true),
    isEligibleCached: vi.fn(() => eligibleOnEvent),
    onVerifiedDownload: vi.fn(),
  };
  const duringDownload: boolean[] = [];
  const afterEvent: boolean[] = [];
  // Mock the disk/network layer beneath BaseUpdater.executeDownload. Keep the
  // real BaseUpdater done callback: dispatch event, then install quit handler.
  const disk = vi
    .spyOn(
      AppUpdater.prototype as unknown as {
        executeDownload: (task: DownloadTask) => Promise<string[]>;
      },
      'executeDownload',
    )
    .mockImplementation(async (task) => {
      duringDownload.push(updater.autoInstallOnAppQuit);
      await task.done({ ...feed, downloadedFile: 'fixture.exe' });
      afterEvent.push(updater.autoInstallOnAppQuit);
      options.isEligible.mockResolvedValue(eligibleAfterDownload);
      return ['fixture.exe'];
    });
  const install = vi.spyOn(updater, 'install').mockReturnValue(true);
  return { updater, options, quitHandlers, duringDownload, afterEvent, disk, install };
}
afterEach(() => vi.restoreAllMocks());

describe('commercial updater contract against installed electron-updater', () => {
  it('arms during verified download event before real addQuitHandler, then installs only on natural quit', async () => {
    const f = fixture();
    await checkCommercialUpdates(f.updater, f.options);
    expect(f.duringDownload).toEqual([false]);
    expect(f.afterEvent).toEqual([true]);
    expect(f.quitHandlers).toHaveLength(1);
    expect(f.options.onVerifiedDownload).toHaveBeenCalledOnce();
    expect(f.updater.listenerCount('update-downloaded')).toBe(0);
    expect(f.install).not.toHaveBeenCalled();
    f.quitHandlers[0]!(0);
    expect(f.install).toHaveBeenCalledWith(true, false);
  });
  it('leaves quit unarmed if cached eligibility is lost during transfer', async () => {
    const f = fixture({ eligibleOnEvent: false });
    await checkCommercialUpdates(f.updater, f.options);
    expect(f.duringDownload).toEqual([false]);
    expect(f.afterEvent).toEqual([false]);
    expect(f.quitHandlers).toHaveLength(0);
    expect(f.options.onVerifiedDownload).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });
  it('post-download eligibility can disarm the already registered natural-quit handler', async () => {
    const f = fixture({ eligibleAfterDownload: false });
    await checkCommercialUpdates(f.updater, f.options);
    expect(f.quitHandlers).toHaveLength(1);
    expect(f.updater.autoInstallOnAppQuit).toBe(false);
    f.quitHandlers[0]!(0);
    expect(f.install).not.toHaveBeenCalled();
  });
  it('honours real isUpdateAvailable false when the provider returns a newer unsupported release', async () => {
    const f = fixture({ available: false });
    await checkCommercialUpdates(f.updater, f.options);
    expect(f.disk).not.toHaveBeenCalled();
    expect(f.quitHandlers).toHaveLength(0);
  });
});
