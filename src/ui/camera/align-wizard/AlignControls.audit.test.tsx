import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { useCameraAlignWizardStore as wizard } from './camera-align-wizard-store';
import { ClearBedStep, SetupStep } from './AlignWizardSteps';
import { DetectStep, DoneStep } from './AlignWizardDetectStep';

const burn = vi.hoisted(() => vi.fn());
const detect = vi.hoisted(() => vi.fn());
vi.mock('./burn-markers-step', () => ({ burnAlignMarkers: burn }));
vi.mock('./detect-camera-alignment', () => ({ detectCameraAlignment: detect }));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));
beforeEach(() => {
  wizard.getState().openWizard();
  burn.mockReset();
  detect.mockReset();
  useLaserStore.setState({ connection: { kind: 'disconnected' } });
  useCameraStore.setState({ sourceState: { kind: 'idle' } });
});

it('gates disconnected marker burn and passes selected power and speed to the transient-job boundary', async () => {
  wizard.setState({ powerPercent: 12, speedMmPerMin: 4200 });
  const host = await mountControl(<SetupStep note={null} />);
  expect(control(host, 'Burn markers').disabled).toBe(true);
  await clickControl(host, 'Burn markers');
  expect(burn).not.toHaveBeenCalled();
  await act(async () => useLaserStore.setState({ connection: { kind: 'connected' } }));
  burn.mockResolvedValue({ kind: 'not-started' });
  await clickControl(host, 'Burn markers');
  expect(burn).toHaveBeenCalledWith({ powerPercent: 12, speedMmPerMin: 4200 });
  expect(wizard.getState().step).toMatchObject({
    kind: 'setup',
    note: expect.stringContaining('did not start'),
  });
});

it('skip and clear-bed actions advance to detection and Done closes the wizard', async () => {
  const setup = await mountControl(<SetupStep note={null} />);
  await clickControl(setup, 'Markers already burned');
  expect(wizard.getState().step).toEqual({ kind: 'detect', status: { kind: 'idle' } });
  const clear = await mountControl(<ClearBedStep />);
  await act(async () => wizard.getState().setStep({ kind: 'clear-bed' }));
  await clickControl(clear, 'Bed is clear — detect');
  expect(wizard.getState().step).toEqual({ kind: 'detect', status: { kind: 'idle' } });
  const done = await mountControl(<DoneStep basis="raw" />);
  await clickControl(done, 'Done');
  expect(wizard.getState().open).toBe(false);
});

it('detect action requires a live source, dispatches once and is disabled while running', async () => {
  const host = await mountControl(<DetectStep status={{ kind: 'idle' }} />);
  expect(control(host, 'Detect markers').disabled).toBe(true);
  await act(async () =>
    useCameraStore.setState({
      sourceState: {
        kind: 'live',
        source: {
          kind: 'machine-jpeg',
          cameraUrl: 'http://camera.invalid',
          frameUrl: 'http://bridge.invalid',
        },
      },
    }),
  );
  detect.mockResolvedValue(undefined);
  await clickControl(host, 'Detect markers');
  expect(detect).toHaveBeenCalledTimes(1);
  const running = await mountControl(<DetectStep status={{ kind: 'running' }} />);
  expect(control(running, 'Detecting…').disabled).toBe(true);
});
