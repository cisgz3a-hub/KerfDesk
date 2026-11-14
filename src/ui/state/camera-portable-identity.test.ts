// ADR-692 Amendment 3: a network camera's calibration follows the same camera
// at the same address to another computer, without its login or path ever
// being written down.

import { pbkdf2Sync, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraBindingCompatibility,
  networkIdentityMatch,
  normalizeCameraCaptureBinding,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { modelFromElsewhere, savedModelFor } from '../../core/camera/model/saved-cameras';
import { cameraCaptureBindingForFrame, publicCameraSourceId } from '../camera/frame-source';

const NVR = 'rtsp://operator:Secret-1@nvr.local:554/Streaming/Channels/101?transportmode=unicast';
const XMEYE =
  'rtsp://cam.local:554/user=admin_password=Old-pass_channel=1_stream=0.sdp?real_stream';
const QUERY_LOGIN = 'http://cam.local:8080/snapshot.cgi?user=admin&pwd=Old-pass&chn=2';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh KerfDesk with its own identity key, as on a second computer. */
async function computer() {
  localStorage.clear();
  vi.resetModules();
  return import('./camera-resource-identity');
}

async function bindingOn(
  identity: Awaited<ReturnType<typeof computer>>,
  url: string,
): Promise<CameraCaptureBinding> {
  const fingerprints = await identity.cameraIdentityFingerprints(url);
  return cameraCaptureBindingForFrame(
    {
      kind: 'machine-rtsp',
      previewUrl: 'http://127.0.0.1:1/preview',
      frameUrl: 'http://127.0.0.1:1/frame',
      liveness: { kind: 'unmonitored', advisory: '' },
      sourceId: publicCameraSourceId(url),
      ...fingerprints,
    },
    1920,
    1080,
  );
}

describe('portable camera identity', () => {
  it('matches the same camera and address under a second identity key', async () => {
    const saved = await bindingOn(await computer(), NVR);
    const here = await bindingOn(await computer(), NVR);
    expect(here.queryFingerprint).not.toBe(saved.queryFingerprint);
    expect(here.portableFingerprint).toBe(saved.portableFingerprint);
    expect(networkIdentityMatch(saved, here)).toBe('elsewhere');
    expect(cameraBindingCompatibility(saved, here)).toBe('match');
    const model = savedCameraModel(saved);
    expect(savedModelFor({ cameraModel: model }, here)).toBe(model);
    expect(modelFromElsewhere(model, here)).toBe(true);
    expect(modelFromElsewhere(model, saved)).toBe(false);
  }, 60_000);

  it('does not match another path or query at the same address', async () => {
    const saved = await bindingOn(await computer(), NVR);
    const identity = await computer();
    for (const other of [
      NVR.replace('/101', '/201'),
      NVR.replace('unicast', 'multicast'),
      XMEYE.replace('channel=1', 'channel=2'),
    ]) {
      const here = await bindingOn(identity, other);
      if (here.sourceId === saved.sourceId) {
        expect(cameraBindingCompatibility(saved, here)).toBe('source-mismatch');
      }
      expect(networkIdentityMatch(saved, here)).toBe('different');
      expect(savedModelFor({ cameraModel: savedCameraModel(saved) }, here)).toBeUndefined();
    }
  }, 60_000);

  it('keeps the match when the password changes in the address, query or path', async () => {
    const identity = await computer();
    for (const [before, after] of [
      [NVR, NVR.replace('Secret-1', 'Secret-2')],
      [QUERY_LOGIN, QUERY_LOGIN.replace('Old-pass', 'New-pass')],
      [XMEYE, XMEYE.replace('Old-pass', 'New-pass')],
    ] as const) {
      const saved = await bindingOn(identity, before);
      const here = await bindingOn(identity, after);
      expect(here.portableFingerprint).toBe(saved.portableFingerprint);
      expect(cameraBindingCompatibility(saved, here)).toBe('match');
    }
  }, 60_000);

  it('hashes only the address without its login, slowly and with a fixed salt', async () => {
    const identity = await computer();
    expect(identity.cameraAddressWithoutLogin(XMEYE)).toBe(
      'rtsp://cam.local:554/channel=1_stream=0.sdp?real_stream=',
    );
    expect(identity.cameraAddressWithoutLogin(QUERY_LOGIN)).toBe(
      'http://cam.local:8080/snapshot.cgi?chn=2',
    );
    const expected = pbkdf2Sync(
      'rtsp://nvr.local:554/Streaming/Channels/101?transportmode=unicast',
      'kerfdesk.camera.identity.v1',
      200_000,
      32,
      'sha256',
    ).toString('hex');
    expect(await identity.cameraPortableFingerprint(NVR)).toBe(`pbkdf2-sha256:${expected}`);
  }, 60_000);

  it('writes no login, path or query into a saved calibration', async () => {
    const identity = await computer();
    for (const url of [NVR, XMEYE, QUERY_LOGIN]) {
      const binding = await bindingOn(identity, url);
      const saved = JSON.stringify(
        normalizeCameraCaptureBinding(JSON.parse(JSON.stringify(binding))),
      );
      expect(saved).toContain('pbkdf2-sha256:');
      for (const secret of [
        'operator',
        'Secret-1',
        'admin',
        'Old-pass',
        'password',
        'Streaming',
        'channel',
        'chn',
      ]) {
        expect(saved).not.toContain(secret);
      }
    }
  }, 60_000);

  it('reads an older calibration without the portable identity as before', () => {
    const keyed = `hmac-sha256:${'a'.repeat(64)}`;
    const saved = { queryFingerprint: keyed };
    expect(networkIdentityMatch(saved, { queryFingerprint: keyed })).toBe('same');
    expect(
      networkIdentityMatch(saved, {
        queryFingerprint: `hmac-sha256:${'b'.repeat(64)}`,
        portableFingerprint: `pbkdf2-sha256:${'c'.repeat(64)}`,
      }),
    ).toBe('different');
    expect(networkIdentityMatch({}, {})).toBe('unknown');
  });
});
