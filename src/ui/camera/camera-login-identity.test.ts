// A running network camera is named by its public address only (ADR-692),
// and a calibration an older version saved still finds its camera.

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraAddressWithoutUserinfo } from '../../core/camera/camera-address-login';
import {
  CAMERA_LOGIN_FORMS,
  STAND_IN_SECRET,
  type CameraLoginForm,
} from '../../core/camera/camera-login-forms.test-fixture';
import { normalizeCameraModelRecord } from '../../core/camera/model/camera-model-record';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { modelBelongsTo } from '../../core/camera/model/saved-cameras';
import { cameraQueryFingerprint } from '../state/camera-resource-identity';
import {
  cameraCaptureBindingForFrame,
  cameraSourceIdentity,
  publicCameraSourceId,
  type ActiveCameraSource,
} from './frame-source';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

function liveSource(form: CameraLoginForm, queryFingerprint?: string): ActiveCameraSource {
  const fingerprint = queryFingerprint === undefined ? {} : { queryFingerprint };
  return form.kind === 'machine-jpeg'
    ? { kind: 'machine-jpeg', frameUrl: 'bridge-frame', cameraUrl: form.address, ...fingerprint }
    : {
        kind: 'machine-rtsp',
        frameUrl: 'bridge-frame',
        previewUrl: 'bridge-preview',
        liveness: { kind: 'unmonitored', advisory: '' },
        sourceId: publicCameraSourceId(form.address),
        ...fingerprint,
      };
}

describe.each(CAMERA_LOGIN_FORMS)('a camera reached with a login in the $label form', (form) => {
  it('is named by its public address in the calibration it gets', () => {
    const capture = cameraCaptureBindingForFrame(liveSource(form), 1280, 720);
    expect(capture.sourceId).toBe(form.publicForm);
    expect(JSON.stringify(capture)).not.toContain(STAND_IN_SECRET);
  });

  it.runIf(form.connects)('still owns the calibration an older version saved for it', async () => {
    // An address no URL parser reads has no keyed identity, now as before.
    const queryFingerprint = await cameraQueryFingerprint(form.address);
    // What an older version saved: the address with only userinfo, query and fragment gone.
    const older = normalizeCameraModelRecord(
      savedCameraModel({
        version: 1,
        sourceKind: form.kind,
        sourceId: cameraAddressWithoutUserinfo(form.address),
        ...(queryFingerprint === undefined ? {} : { queryFingerprint }),
        width: 1280,
        height: 720,
        resizeMode: 'unknown',
      }),
    );
    expect(older?.capture?.sourceId).toBe(form.publicForm);
    if (older === undefined) return;
    expect(modelBelongsTo(older, cameraSourceIdentity(liveSource(form, queryFingerprint)))).toBe(
      true,
    );
  });
});
