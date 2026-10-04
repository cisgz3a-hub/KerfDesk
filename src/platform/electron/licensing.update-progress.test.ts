import { expect, it } from 'vitest';
import { parseCommercialUpdateStatus } from './licensing';

const status = {
  mode: 'manual',
  state: 'downloading',
  currentVersion: '1.0.7',
  version: '1.0.8',
  checkedAt: null,
  installOnQuit: false,
  downloadProgress: { phase: 'receiving', receivedBytes: 123, totalBytes: 1_000 },
};
it('accepts legacy progress-free status and copies only bounded progress fields', () => {
  const { downloadProgress: _oldProgress, ...legacy } = status;
  expect(parseCommercialUpdateStatus(legacy)).toEqual(legacy);
  const parsed = parseCommercialUpdateStatus({
    ...status,
    downloadProgress: { ...status.downloadProgress, url: 'file:///private-path' },
  });
  expect(parsed.downloadProgress).toEqual(status.downloadProgress);
  expect(parsed.downloadProgress).not.toBe(status.downloadProgress);
  expect(JSON.stringify(parsed)).not.toContain('private-path');
});

it.each([
  { mode: undefined },
  { state: 'ready' },
  { version: null },
  { downloadProgress: null },
  { downloadProgress: 'secret' },
  ...[
    { phase: 'unknown' },
    { receivedBytes: -1 },
    { receivedBytes: 1.5 },
    { receivedBytes: Number.NaN },
    { receivedBytes: Number.POSITIVE_INFINITY },
    { receivedBytes: 1_001 },
    { totalBytes: 0 },
    { totalBytes: 1.5 },
    { totalBytes: 300_000_001 },
    { phase: 'starting', receivedBytes: 1 },
    { phase: 'verifying', receivedBytes: 999 },
  ].map((progress) => ({ downloadProgress: { ...status.downloadProgress, ...progress } })),
])('rejects inconsistent or unbounded download progress %j', (patch) => {
  expect(() => parseCommercialUpdateStatus({ ...status, ...patch })).toThrow(
    'Invalid update status',
  );
});
