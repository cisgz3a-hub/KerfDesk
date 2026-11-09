// Saved and shared files never carry a camera login (ADR-692): a project, an
// exported machine profile, and the text an older version already wrote.

import { describe, expect, it } from 'vitest';
import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import {
  CAMERA_LOGIN_FORMS,
  STAND_IN_SECRET,
  type CameraLoginForm,
} from '../../core/camera/camera-login-forms.test-fixture';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene/project';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeCanonicalDeviceProfile,
  serializeMachineProfileDocument,
} from '../machine-profile/machine-profile-io';
import { deserializeProject } from './deserialize-project';
import { projectJsonWithPublicCameraIdentities } from './public-camera-identity-json';
import { serializeProject } from './serialize-project';

// The retired camera profile's stream address, also kept by older versions.
const LEGACY_STREAM = `rtsp://192.168.1.10:554/user=viewer&password=${STAND_IN_SECRET}&channel=1`;
const FINGERPRINT = `hmac-sha256:${'b'.repeat(64)}`;

/** A camera record exactly as an older version could hold it: the address as typed. */
function olderCapture(form: CameraLoginForm): CameraCaptureBinding {
  return {
    version: 1,
    sourceKind: form.kind,
    sourceId: form.address,
    queryFingerprint: FINGERPRINT,
    width: 1280,
    height: 720,
    resizeMode: 'unknown',
  };
}

function olderDevice(form: CameraLoginForm): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'camera'],
    cameraModel: savedCameraModel(olderCapture(form)),
    otherCameraModels: [savedCameraModel({ ...olderCapture(form), width: 640, height: 360 })],
    cameraProfile: {
      id: 'legacy',
      name: 'Legacy camera',
      deviceId: '',
      enabled: false,
      transparency: 0.4,
      resolution: { width: 1280, height: 720 },
      source: { kind: 'rtsp', url: LEGACY_STREAM },
    },
  };
}

function olderProjectText(form: CameraLoginForm): string {
  // Written whole, as an older version's Save did.
  return `${JSON.stringify({ ...createProject(), device: olderDevice(form) }, null, 2)}\n`;
}

describe.each(CAMERA_LOGIN_FORMS)('a camera login in the $label form', (form) => {
  it('is never written into a project, even from a record held in memory', () => {
    const project = { ...createProject(), device: olderDevice(form) };
    const text = serializeProject(project);
    expect(text).not.toContain(STAND_IN_SECRET);
    expect(text).toContain(form.publicForm);
  });

  it('is dropped when a project an older version saved is opened, and stays out on Save', () => {
    const opened = deserializeProject(olderProjectText(form));
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') return;
    const device = opened.project.device;
    expect(device.cameraModel?.capture?.sourceId).toBe(form.publicForm);
    expect(device.otherCameraModels?.[0]?.capture?.sourceId).toBe(form.publicForm);
    // The keyed identity is kept, so the calibration still finds its camera.
    expect(device.cameraModel?.capture?.queryFingerprint).toBe(FINGERPRINT);
    expect(JSON.stringify(device)).not.toContain(STAND_IN_SECRET);
    expect(serializeProject(opened.project)).not.toContain(STAND_IN_SECRET);
  });

  it('is never written into an exported machine profile', () => {
    const device = olderDevice(form);
    const exported = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: device,
      source: { kind: 'custom', label: 'Shop laser' },
      reviewNotes: [],
    });
    expect(exported).not.toContain(STAND_IN_SECRET);
    expect(serializeCanonicalDeviceProfile(device)).not.toContain(STAND_IN_SECRET);
  });

  it('is dropped when a machine profile an older version exported is imported', () => {
    const older = JSON.stringify({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: olderDevice(form),
      source: { kind: 'custom', label: 'Shop laser' },
      reviewNotes: [],
    });
    const imported = deserializeMachineProfileDocument(older);
    expect(imported.kind).toBe('ok');
    if (imported.kind !== 'ok') return;
    expect(JSON.stringify(imported.document)).not.toContain(STAND_IN_SECRET);
  });

  it('is dropped from project text kept whole, such as a saved artwork', () => {
    const scrubbed = projectJsonWithPublicCameraIdentities(olderProjectText(form));
    expect(scrubbed).not.toContain(STAND_IN_SECRET);
    expect(deserializeProject(scrubbed).kind).toBe('ok');
  });
});

it('leaves project text with no camera login exactly as it was', () => {
  const text = serializeProject(createProject());
  expect(projectJsonWithPublicCameraIdentities(text)).toBe(text);
  const usb = serializeProject({
    ...createProject(),
    device: {
      ...DEFAULT_DEVICE_PROFILE,
      cameraModel: savedCameraModel({
        version: 1,
        sourceKind: 'usb',
        sourceId: 'usb-device-id',
        width: 1280,
        height: 720,
        resizeMode: 'none',
      }),
    },
  });
  expect(projectJsonWithPublicCameraIdentities(usb)).toBe(usb);
});
