// The target step's ways to the rings (ADR-441 Amendment 5): the target can go
// on the canvas without a connection, and the step asks for Home first without
// blocking the engrave.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import {
  HOME_BEFORE_TARGET_NOTE,
  NO_HOMING_TARGET_NOTE,
  TARGET_ON_CANVAS_MESSAGE,
  TARGET_ON_CANVAS_NEXT_STEPS,
} from './CalibrationSetupStep';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from './camera-calibration-store';

vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));

beforeEach(() => {
  resetStore();
  localStorage.clear();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().openWizard();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, sourceEpoch: 0, overlayVisible: false });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
});

function withHoming(enabled: boolean): void {
  const { project } = useStore.getState();
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled } },
    },
  });
}

describe('calibration target step', () => {
  it('adds the target to the canvas without a connection, then waits at the photo', async () => {
    await mountControl(<CameraCalibrationWizard />);
    expect(control(document.body, 'Engrave target').disabled).toBe(true);
    await clickControl(document.body, 'Add target to canvas');
    const { project, jobPlacement } = useStore.getState();
    expect(project.scene.layers.map((layer) => layer.id)).toEqual(['camera-bed-target']);
    // The default 300 × 200 mm sheet in the middle of the bed: 7 × 5 rings.
    expect(project.scene.objects).toHaveLength(35);
    expect(jobPlacement.startFrom).toBe('absolute');
    expect(useCameraCalibrationStore.getState()).toMatchObject({
      minimized: true,
      step: { kind: 'photo', status: { kind: 'idle' }, canvasTarget: true },
    });
  });

  // Annoyance audit A5-P2-5: the steps to take next were a toast that left.
  it('keeps what to do next in the waiting photo step, and the toast points there', async () => {
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Add target to canvas');

    const next = document.body.querySelector('[role="dialog"] [role="status"]');
    expect(next?.textContent).toBe(`Next: ${TARGET_ON_CANVAS_NEXT_STEPS}`);
    expect(TARGET_ON_CANVAS_NEXT_STEPS).toContain('Frame and Start it like any job');
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast).toMatchObject({ variant: 'success', message: TARGET_ON_CANVAS_MESSAGE });
    expect(TARGET_ON_CANVAS_MESSAGE).toMatch(/What to do next is in the Camera setup panel/);

    // Once the photo is being taken, the step no longer says to burn first.
    await act(async () =>
      useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } }),
    );
    expect(document.body.textContent).not.toContain(TARGET_ON_CANVAS_NEXT_STEPS);
  });

  it('asks for Home before the target on an unhomed machine, without blocking it', async () => {
    withHoming(true);
    useLaserStore.setState({ connection: { kind: 'connected' }, homingState: 'unknown' });
    await mountControl(<CameraCalibrationWizard />);
    expect(document.body.textContent).toContain(HOME_BEFORE_TARGET_NOTE);
    expect(control(document.body, 'Engrave target').disabled).toBe(false);

    await act(async () => useLaserStore.setState({ homingState: 'confirmed' }));
    expect(document.body.textContent).not.toContain(HOME_BEFORE_TARGET_NOTE);

    await act(async () => withHoming(false));
    expect(document.body.textContent).toContain(NO_HOMING_TARGET_NOTE);
  });
});
