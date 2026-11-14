import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore, type CameraSourceState } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
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
