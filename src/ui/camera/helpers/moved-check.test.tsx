// "Camera moved?" (ADR-663 Amendment 3): a picture from the running camera,
// compared over what it sees around the bed with the view kept when its
// calibration was last known good, warns of a move of a millimetre or more,
// and stays quiet when the camera is where it was or cannot be compared.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { viewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { clickControl, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { CameraMovedNotice } from '../panel/CameraMovedNotice';
import { checkCameraMoved, markCameraSteady, useCameraMovedStore } from './moved-check';
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

// What the camera sees: smooth shapes everywhere, slid by (dx, dy) camera
// pixels when the camera has moved, with `gain` for a brighter room.
function frame(dx: number, dy: number, gain = 1): RgbaImage {
  const width = 1280;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      const value =
        128 +
        40 * Math.sin(0.057 * sx + 0.021 * sy) +
        35 * Math.cos(0.039 * sy - 0.015 * sx) +
        25 * Math.sin(0.093 * sx) * Math.cos(0.069 * sy);
      const v = Math.min(255, value * gain);
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
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
  useCameraMovedStore.setState({ state: { kind: 'unknown' }, dismissedFor: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
  useToastStore.getState().dismissToastKey('camera-moved');
});

describe('checkCameraMoved', () => {
  it('says nothing without a view to compare with', () => {
    expect(checkCameraMoved(source, frame(0, 0))).toEqual({ kind: 'unknown' });
  });

  it('finds the camera where it was, even in a brighter room', () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    expect(checkCameraMoved(source, frame(0, 0))).toEqual({ kind: 'steady' });
    expect(checkCameraMoved(source, frame(0, 0, 1.2))).toEqual({ kind: 'steady' });
  });

  it('warns of a camera that has slid, in millimetres on the bed, with one toast', () => {
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const state = checkCameraMoved(source, frame(12, -7));
    expect(state.kind).toBe('moved');
    if (state.kind !== 'moved') return;
    expect(state.mm).toBeGreaterThan(1);
    expect(state.calibratedAt).toBe(record.calibratedAt);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      expect.stringContaining('The camera may have moved'),
    ]);
    checkCameraMoved(source, frame(12, -7));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('toasts again when small shifts cumulatively cross the dismissed move threshold', () => {
    useCameraStore.setState({ panelOpen: false });
    saveViewReference(record, viewThumbnail(frame(0, 0)));
    const first = checkCameraMoved(source, frame(12, -7));
    if (first.kind !== 'moved') throw new Error('Expected the initial camera move');
    useCameraMovedStore.getState().dismiss();
    useToastStore.getState().dismissToastKey('camera-moved');

    const next = checkCameraMoved(source, frame(13, -7));
    if (next.kind !== 'moved') throw new Error('Expected the next camera move');
    expect(next.mm - first.mm).toBeGreaterThan(0);
    expect(next.mm - first.mm).toBeLessThan(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    const crossed = checkCameraMoved(source, frame(14, -7));
    if (crossed.kind !== 'moved') throw new Error('Expected the accumulated camera move');
    expect(crossed.mm - next.mm).toBeGreaterThan(0);
    expect(crossed.mm - next.mm).toBeLessThan(1);
    expect(crossed.mm - first.mm).toBeGreaterThanOrEqual(1);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      `The camera may have moved, by about ${crossed.mm.toFixed(1)} mm. Open Camera to fix it.`,
    ]);
    const toast = useToastStore.getState().toasts[0];
    checkCameraMoved(source, frame(14, -7));
    expect(useToastStore.getState().toasts[0]).toBe(toast);

    useCameraMovedStore.getState().dismiss();
    useToastStore.getState().dismissToastKey('camera-moved');
    expect(checkCameraMoved(source, frame(0, 0))).toEqual({ kind: 'steady' });
    expect(useCameraMovedStore.getState().dismissedFor).toBeNull();
    checkCameraMoved(source, frame(12, -7));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
  it('does not check a camera on the laser head', () => {
    const head = {
      ...record,
      mount: { kind: 'head' as const, headAtCalibrationMm: { x: 1, y: 1 } },
    };
    useStore.getState().updateDeviceProfile({ cameraModel: head });
    saveViewReference(head, viewThumbnail(frame(0, 0)));
    expect(checkCameraMoved(source, frame(12, -7))).toEqual({ kind: 'unknown' });
  });
});

describe('the warning in the Camera panel', () => {
  it('offers the fix and the check, and Dismiss keeps it quiet for this calibration', async () => {
    useCameraMovedStore.setState({
      state: { kind: 'moved', mm: 2.4, calibratedAt: record.calibratedAt },
    });
    const host = await mountControl(<CameraMovedNotice />);
    expect(host.textContent).toContain('The camera may have moved, by about 2.4 mm.');
    expect(host.textContent).toContain('Fix a small offset…');
    expect(host.textContent).toContain('Check camera…');
    await clickControl(host, 'Dismiss');
    expect(host.textContent).toBe('');
    await act(async () =>
      useCameraMovedStore.setState({
        state: { kind: 'moved', mm: 3, calibratedAt: record.calibratedAt },
      }),
    );
    expect(host.textContent).toBe('');
  });

  // Audit follow-up to #1405: a nudge fix keeps calibratedAt, so a dismissal
  // keyed on the calibration alone silenced every later move for good.
  it('warns again after the view was confirmed steady, or for a clearly bigger move', async () => {
    useCameraMovedStore.setState({
      state: { kind: 'moved', mm: 2.4, calibratedAt: record.calibratedAt },
    });
    const host = await mountControl(<CameraMovedNotice />);
    await clickControl(host, 'Dismiss');
    expect(host.textContent).toBe('');

    await act(async () =>
      useCameraMovedStore.setState({
        state: { kind: 'moved', mm: 3.6, calibratedAt: record.calibratedAt },
      }),
    );
    expect(host.textContent).toContain('by about 3.6 mm');

    await clickControl(host, 'Dismiss');
    await act(async () => markCameraSteady());
    expect(useCameraMovedStore.getState().dismissedFor).toBeNull();
    await act(async () =>
      useCameraMovedStore.setState({
        state: { kind: 'moved', mm: 1.5, calibratedAt: record.calibratedAt },
      }),
    );
    expect(host.textContent).toContain('by about 1.5 mm');
  });
});
