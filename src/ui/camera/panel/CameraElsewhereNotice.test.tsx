import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore, type CameraSourceState } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { CALIBRATION_ELSEWHERE_JOB_WARNING } from '../helpers/calibration-elsewhere';
import { cameraMovedStartWarning } from '../helpers/camera-moved-start-warning';
import { markCameraSteady } from '../helpers/moved-check';
import { saveViewReference } from '../helpers/view-reference';
import { CAMERA_ELSEWHERE_NOTICE, CameraElsewhereNotice } from './CameraElsewhereNotice';

const CAMERA_URL = 'http://192.168.10.1:8080/snapshot';
const THERE = `hmac-sha256:${'a'.repeat(64)}`;
const HERE = `hmac-sha256:${'b'.repeat(64)}`;
const PORTABLE = `pbkdf2-sha256:${'c'.repeat(64)}`;

const binding: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'machine-jpeg',
  sourceId: 'http://192.168.10.1:8080/',
  queryFingerprint: THERE,
  portableFingerprint: PORTABLE,
  width: 1280,
  height: 960,
  resizeMode: 'unknown',
};
const fromElsewhere = savedCameraModel(binding);

function live(queryFingerprint: string): CameraSourceState {
  return {
    kind: 'live',
    source: {
      kind: 'machine-jpeg',
      cameraUrl: CAMERA_URL,
      frameUrl: 'http://127.0.0.1:1/frame.jpg',
      queryFingerprint,
      portableFingerprint: PORTABLE,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.getState().updateDeviceProfile({ cameraModel: fromElsewhere });
});
afterEach(() => {
  useCameraStore.setState({ sourceState: { kind: 'idle' } });
});

describe('a calibration made on another computer', () => {
  it('asks for Check camera once, until a check keeps a view here', async () => {
    useCameraStore.setState({ sourceState: live(HERE) });
    const host = await mountControl(<CameraElsewhereNotice />);
    expect(host.textContent).toContain(CAMERA_ELSEWHERE_NOTICE);
    expect(host.textContent).toContain('Check camera');
    await act(async () => {
      saveViewReference(fromElsewhere, { width: 1, height: 1, data: new Uint8Array([7]) });
      markCameraSteady();
    });
    expect(host.textContent).not.toContain(CAMERA_ELSEWHERE_NOTICE);
  });

  it('says nothing for a calibration made on this computer', async () => {
    useCameraStore.setState({ sourceState: live(THERE) });
    const host = await mountControl(<CameraElsewhereNotice />);
    expect(host.textContent).not.toContain(CAMERA_ELSEWHERE_NOTICE);
  });
});

// Camera audit v2 K6-P2-1 (ADR-692 Amendment 4): the address alone cannot tell
// the camera apart from another one there, and the notice lived in the Camera
// panel only, claiming "the same camera". Job Review says it too, until a
// Check camera passes on this computer.
describe('Job Review for a calibration made on another computer', () => {
  it('says so until a check keeps a view here', () => {
    const device = useStore.getState().project.device;
    expect(cameraMovedStartWarning(device, live(HERE))).toBe(CALIBRATION_ELSEWHERE_JOB_WARNING);
    expect(cameraMovedStartWarning(device, live(THERE))).toBeNull();
    saveViewReference(fromElsewhere, { width: 1, height: 1, data: new Uint8Array([7]) });
    expect(cameraMovedStartWarning(device, live(HERE))).toBeNull();
  });

  it('does not claim it is the same camera', async () => {
    useCameraStore.setState({ sourceState: live(HERE) });
    const host = await mountControl(<CameraElsewhereNotice />);
    expect(host.textContent).not.toContain('same camera');
    expect(host.textContent).toContain('may be another camera');
  });
});
