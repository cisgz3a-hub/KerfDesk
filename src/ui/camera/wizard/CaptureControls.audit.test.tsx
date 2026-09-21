import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderCheckerboardView } from '../../../core/camera/board-render-fixtures';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useCameraStore } from '../../state/camera-store';
import { useCameraWizardStore as wizard } from './camera-wizard-store';
import { CaptureStep } from './CaptureStep';
import type { LiveCaptureElement } from '../frame-capture';
import type { LiveDetectionState } from './use-live-detection';

const capture = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({
  state: { corners: null, frameWidth: 320, frameHeight: 240, stableTicks: 0 } as LiveDetectionState,
}));
vi.mock('../frame-capture', () => ({
  captureElementFrame: capture,
  elementFrameSize: () => ({ width: 320, height: 240 }),
  liveDetectScale: () => 1,
}));
vi.mock('./use-live-detection', () => ({ useLiveDetection: () => live.state }));
vi.mock('../CameraSourceView', () => ({
  CameraSourceView: (props: { onElement?: (el: LiveCaptureElement | null) => void }) => (
    <img ref={props.onElement} alt="Simulated camera" />
  ),
}));
beforeEach(() => {
  wizard.getState().openWizard();
  capture.mockReset();
  live.state = { corners: null, frameWidth: 320, frameHeight: 240, stableTicks: 0 };
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'machine-jpeg',
        cameraUrl: 'http://camera.invalid/frame',
        frameUrl: 'http://bridge.invalid/frame',
      },
    },
  });
});

it('gates missing board capture and empty reset/solve, and toggles auto-capture', async () => {
  const host = await mountControl(<CaptureStep />);
  expect(control(host, 'Capture now').disabled).toBe(true);
  expect(control(host, 'Reset').disabled).toBe(true);
  expect(control(host, 'Solve calibration').disabled).toBe(true);
  await clickControl(host, 'Auto-capture');
  expect(wizard.getState().autoCapture).toBe(false);
  await clickControl(host, 'Auto-capture');
  expect(wizard.getState().autoCapture).toBe(true);
});

it('manual capture ingests actual checkerboard pixels, Reset discards them and five captures enable Solve', async () => {
  const gray = renderCheckerboardView({
    width: 320,
    height: 240,
    k: { fx: 180, fy: 180, cx: 160, cy: 120 },
    d: [-0.18, 0.03, 0, 0],
    spec: { rows: 6, cols: 9 },
    spacingMm: 11,
    rvec: [0, 0, 0],
    tvec: [-44, -27.5, 95],
  });
  const data = new Uint8ClampedArray(320 * 240 * 4);
  for (let i = 0; i < gray.data.length; i += 1) {
    const value = Math.round(gray.data[i]!);
    data.set([value, value, value, 255], i * 4);
  }
  capture.mockReturnValue({ width: 320, height: 240, data });
  live.state = { ...live.state, corners: [] };
  wizard.setState({ autoCapture: false });
  const host = await mountControl(<CaptureStep />);
  await clickControl(host, 'Capture now');
  expect(wizard.getState().session.captures).toHaveLength(1);
  expect(wizard.getState().session.captures[0]?.imagePoints).toHaveLength(54);
  await clickControl(host, 'Reset');
  expect(wizard.getState().session.captures).toHaveLength(0);
  for (let index = 0; index < 5; index += 1) await clickControl(host, 'Capture now');
  expect(control(host, 'Solve calibration').disabled).toBe(false);
  await clickControl(host, 'Solve calibration');
  expect(wizard.getState()).toMatchObject({ solving: true, step: 'review' });
  await act(async () => wizard.setState({ solving: false }));
});
