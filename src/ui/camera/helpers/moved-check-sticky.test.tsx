// Rolling audit v13 Y1-P2-2 (ADR-663 Amendment 5): a "camera may have moved"
// warning stays until the view is confirmed or dismissed. A later weak match
// replaced a showing warning with `unknown` and the notice vanished while the
// camera was still out; a view that never matched again said nothing at all;
// and nothing at Start read the warning.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { viewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { createProject } from '../../../core/scene';
import { mountControl } from '../../image-editor/control-audit-test-support';
import { demotedPolicyWarnings } from '../../laser/start-job-readiness-policy';
import { machineSnapshot } from '../../laser/start-machine-snapshot';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { CameraMovedNotice } from '../panel/CameraMovedNotice';
import { cameraMovedJobWarning } from './camera-moved-store';
import {
  checkCameraMoved,
  markCameraSteady,
  useCameraMovedStore,
  WEAK_CHECKS_FOR_CHANGED,
} from './moved-check';
import { saveViewReference } from './view-reference';

const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};
const record = savedCameraModel({
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
});
const initialCamera = useCameraStore.getState();

// The machine as the camera saw it, slid by (dx, dy) camera pixels.
function frame(dx: number, dy: number): RgbaImage {
  return picture((x, y) => {
    const sx = x - dx;
    const sy = y - dy;
    return (
      128 +
      40 * Math.sin(0.057 * sx + 0.021 * sy) +
      35 * Math.cos(0.039 * sy - 0.015 * sx) +
      25 * Math.sin(0.093 * sx) * Math.cos(0.069 * sy)
    );
  });
}

// Something else entirely: the camera knocked to look elsewhere.
function elsewhere(): RgbaImage {
  return picture(
    (x, y) => 128 + 60 * Math.sin(0.21 * x - 0.11 * y) * Math.cos(0.17 * y + 0.05 * x),
  );
}

function picture(value: (x: number, y: number) => number): RgbaImage {
  const width = 1280;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.max(0, Math.min(255, value(x, y)));
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: record },
    },
  });
  useCameraStore.setState({
    ...initialCamera,
    sourceState: { kind: 'live', source },
    panelOpen: false,
  });
  useCameraMovedStore.setState({ state: { kind: 'unknown' }, dismissedFor: null, weakChecks: 0 });
  useToastStore.setState({ toasts: [] });
  saveViewReference(record, viewThumbnail(frame(0, 0)));
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
  useToastStore.getState().dismissToastKey('camera-moved');
});

describe('a camera-moved warning stays until the view is confirmed', () => {
  it('is not withdrawn by a later weak match, and the notice keeps showing', async () => {
    const moved = checkCameraMoved(source, frame(12, -7));
    expect(moved.kind).toBe('moved');
    const host = await mountControl(<CameraMovedNotice />);
    expect(host.textContent).toContain('The camera may have moved');

    // A further knock: the view no longer matches.
    await act(async () => {
      expect(checkCameraMoved(source, elsewhere())).toBe(moved);
    });
    expect(useCameraMovedStore.getState().state).toBe(moved);
    expect(host.textContent).toContain('The camera may have moved');
  });

  it('says the camera may have moved once the view fails to match check after check', async () => {
    expect(checkCameraMoved(source, elsewhere())).toEqual({ kind: 'unknown' });
    expect(useToastStore.getState().toasts).toHaveLength(0);
    for (let i = 1; i < WEAK_CHECKS_FOR_CHANGED; i += 1) checkCameraMoved(source, elsewhere());
    expect(useCameraMovedStore.getState().state).toEqual({
      kind: 'changed',
      calibratedAt: record.calibratedAt,
    });
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      expect.stringContaining('no longer matches its calibration'),
    ]);
    checkCameraMoved(source, elsewhere());
    expect(useToastStore.getState().toasts).toHaveLength(1);

    const host = await mountControl(<CameraMovedNotice />);
    expect(host.textContent).toContain('no longer matches its calibration');
    expect(host.textContent).toContain('Check camera…');
    expect(host.textContent).not.toContain('Fix a small offset…');
  });

  it('clears on a confident match where the camera was, or on a new calibration', () => {
    checkCameraMoved(source, frame(12, -7));
    expect(checkCameraMoved(source, frame(0, 0))).toEqual({ kind: 'steady' });

    for (let i = 0; i < WEAK_CHECKS_FOR_CHANGED; i += 1) checkCameraMoved(source, elsewhere());
    expect(useCameraMovedStore.getState().state.kind).toBe('changed');
    markCameraSteady();
    expect(useCameraMovedStore.getState().state).toEqual({ kind: 'steady' });
    expect(useCameraMovedStore.getState().weakChecks).toBe(0);
  });

  it('keeps a dismissed "no longer matches" quiet, and warns again for a measured move', async () => {
    for (let i = 0; i < WEAK_CHECKS_FOR_CHANGED; i += 1) checkCameraMoved(source, elsewhere());
    useCameraMovedStore.getState().dismiss();
    const host = await mountControl(<CameraMovedNotice />);
    expect(host.textContent).toBe('');
    await act(async () => {
      checkCameraMoved(source, frame(12, -7));
    });
    expect(host.textContent).toContain('The camera may have moved: the picture may be up to about');
  });

  it('shows only for the calibration it was measured against', async () => {
    useCameraMovedStore.setState({
      state: { kind: 'changed', calibratedAt: '2001-01-01T00:00:00.000Z' },
    });
    const host = await mountControl(<CameraMovedNotice />);
    expect(host.textContent).toBe('');
  });
});

describe('Job Review reads the camera-moved warning', () => {
  it('carries a showing warning into the Start snapshot, said while camera placement is on', () => {
    checkCameraMoved(source, frame(12, -7));
    const project = useStore.getState().project;
    const snapshot = machineSnapshot(project, useLaserStore.getState(), useCameraStore.getState());
    const warning = snapshot.cameraMovedWarning;
    expect(warning).toContain('Camera placement is on, but the camera may have moved');

    const placed = demotedPolicyWarnings(createProject(), {
      ...snapshot,
      cameraPlacementActive: true,
    });
    expect(placed).toContain(warning);
    const notPlaced = demotedPolicyWarnings(createProject(), {
      ...snapshot,
      cameraPlacementActive: false,
    });
    expect(notPlaced).not.toContain(warning);
  });

  it('drops it once dismissed', () => {
    checkCameraMoved(source, frame(12, -7));
    useCameraMovedStore.getState().dismiss();
    const project = useStore.getState().project;
    const snapshot = machineSnapshot(project, useLaserStore.getState(), useCameraStore.getState());
    expect(snapshot.cameraMovedWarning).toBeNull();
  });

  it('sends a turned camera to Check camera, not the offset fix', () => {
    const turned = cameraMovedJobWarning({
      kind: 'moved',
      mm: 5.3,
      displacementsMm: [
        { x: 0.1, y: 0 },
        { x: 3, y: -4 },
        { x: 3, y: 4 },
        { x: -3, y: 4 },
        { x: -3, y: -4 },
      ],
      calibratedAt: record.calibratedAt,
    });
    expect(turned).toContain('up to about 5.3 mm');
    expect(turned).toContain('Fix a small offset cannot put right');
    const slid = cameraMovedJobWarning({
      kind: 'moved',
      mm: 2,
      displacementsMm: Array.from({ length: 5 }, () => ({ x: 2, y: 0 })),
      calibratedAt: record.calibratedAt,
    });
    expect(slid).toContain('Use Fix a small offset or Check camera');
  });
});
