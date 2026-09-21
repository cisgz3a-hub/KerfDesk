import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CalibrationSession } from '../../../core/camera';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { clickControl, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { useTutorialStore } from '../../tutorials/tutorial-store';
import { useCameraWizardStore as wizard } from './camera-wizard-store';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import { ReviewStep } from './ReviewStep';

const print = vi.hoisted(() => vi.fn());
vi.mock('./print-checkerboard', () => ({ printCheckerboard: print }));
const write = vi.fn();
const pick = vi.fn<PlatformAdapter['pickFileForSave']>();
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: pick,
  serial: { isSupported: () => false, requestPort: async () => null },
};
beforeEach(() => {
  resetStore();
  wizard.getState().openWizard();
  print.mockReset();
  write.mockReset();
  pick.mockReset();
});

it('prints and saves the configured scale board through mocked platform boundaries and starts capture', async () => {
  print.mockReturnValue('printed');
  pick.mockResolvedValue({ displayName: 'checkerboard.svg', write });
  const host = await mountControl(
    <PlatformProvider adapter={platform}>
      <CameraCalibrationWizard />
    </PlatformProvider>,
  );
  await clickControl(host, 'Print checkerboard…');
  expect(print).toHaveBeenCalledWith(expect.stringContaining('width="120mm" height="104mm"'));
  await clickControl(host, 'Save…');
  expect(pick).toHaveBeenCalledWith({
    suggestedName: 'checkerboard-9x6-10mm.svg',
    extensions: ['.svg'],
  });
  expect(write).toHaveBeenCalledWith(
    expect.stringContaining('this bar must measure exactly 100 mm'),
  );
  await clickControl(host, 'Start capturing');
  expect(wizard.getState().step).toBe('capture');
});

it('minimizes and expands the same calibration session, opens its lesson and exits', async () => {
  const host = await mountControl(
    <PlatformProvider adapter={platform}>
      <CameraCalibrationWizard />
    </PlatformProvider>,
  );
  const session = wizard.getState().session;
  await clickControl(host, 'Minimize');
  expect(wizard.getState().minimized).toBe(true);
  await clickControl(host, 'Expand');
  expect(wizard.getState().minimized).toBe(false);
  expect(wizard.getState().session).toBe(session);
  await clickControl(host, 'Tutorial: Camera calibration');
  expect(useTutorialStore.getState().tutorialId).toBe('camera');
  await clickControl(host, 'Close Calibrate camera lens');
  expect(wizard.getState().open).toBe(false);
});

it('failed review resets capture; successful review switches both images, returns to capture and applies recorded calibration', async () => {
  wizard.setState({
    session: { kind: 'failed', captures: [], reason: 'too-few-views' },
    step: 'review',
  });
  const host = await mountControl(<ReviewStep />);
  await clickControl(host, 'Back to capture');
  expect(wizard.getState()).toMatchObject({
    step: 'capture',
    session: { kind: 'collecting', captures: [] },
  });
  await act(async () =>
    wizard.setState({
      session: solved(),
      step: 'review',
      captureBinding: {
        version: 1,
        sourceKind: 'usb',
        sourceId: 'audit',
        width: 320,
        height: 240,
        resizeMode: 'none',
      },
    }),
  );
  await clickControl(host, 'Original');
  expect(wizard.getState().abMode).toBe('raw');
  await clickControl(host, 'Corrected');
  expect(wizard.getState().abMode).toBe('rectified');
  await clickControl(host, 'Capture more poses');
  expect(wizard.getState().step).toBe('capture');
  await clickControl(host, 'Apply calibration');
  expect(useStore.getState().project.device.cameraCalibration).toMatchObject({
    capture: { sourceId: 'audit', width: 320, height: 240 },
  });
  expect(wizard.getState().open).toBe(false);
});

function solved(): CalibrationSession {
  return {
    kind: 'solved',
    captures: [],
    result: {
      kind: 'ok',
      intrinsics: { fx: 200, fy: 200, cx: 160, cy: 120 },
      distortion: [0, 0, 0, 0],
      imageWidth: 320,
      imageHeight: 240,
      views: [],
      perViewRmsPx: [],
      rmsPx: 0.25,
      iterations: 1,
      converged: true,
      exit: 'tolerance',
      coverage: [],
    },
    trust: { kind: 'trusted' },
    diversity: { kind: 'ok', maxSpreadRad: 0.2 },
  };
}
