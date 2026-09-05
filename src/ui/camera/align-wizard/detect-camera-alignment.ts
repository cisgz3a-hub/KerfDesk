import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { runAutoAlign } from '../auto-align';
import { useCameraAlignWizardStore, type AlignWizardStep } from './camera-align-wizard-store';

/** The request belongs to the wizard, so minimize/expand may remount its view. */
export async function detectCameraAlignment(): Promise<void> {
  const wizard = useCameraAlignWizardStore.getState();
  const camera = useCameraStore.getState();
  if (!wizard.open || wizard.step.kind !== 'detect' || wizard.step.status.kind === 'running')
    return;
  if (camera.sourceState.kind !== 'live') return;
  const source = camera.sourceState.source;
  const { projectDocumentEpoch, project } = useStore.getState();
  const device = project.device;
  const running: AlignWizardStep = { kind: 'detect', status: { kind: 'running' } };
  wizard.setStep(running);
  let active = true;
  const stillThisRequest = (): boolean => {
    const current = useCameraAlignWizardStore.getState();
    return current.open && current.step === running;
  };
  const matchesInputs = (): boolean => {
    const current = useStore.getState();
    const currentCamera = useCameraStore.getState();
    return (
      current.projectDocumentEpoch === projectDocumentEpoch &&
      current.project.device === device &&
      currentCamera.sourceEpoch === camera.sourceEpoch &&
      currentCamera.sourceState.kind === 'live' &&
      currentCamera.sourceState.source === source &&
      useCameraAlignWizardStore.getState().planeHeightMm === wizard.planeHeightMm
    );
  };
  // Latch retirement even when a changed source/device is later restored.
  // Publish cancellation now, never when the old capture eventually resolves.
  const invalidate = (): void => {
    if (!active || (stillThisRequest() && matchesInputs())) return;
    active = false;
    cleanup();
    if (stillThisRequest()) {
      wizard.setStep({ kind: 'detect', status: { kind: 'idle' } });
    }
  };
  const unsubscribe = [
    useStore.subscribe(invalidate),
    useCameraStore.subscribe(invalidate),
    useCameraAlignWizardStore.subscribe(invalidate),
  ];
  const cleanup = (): void => unsubscribe.forEach((release) => release());
  const isCurrent = (): boolean => active && stillThisRequest() && matchesInputs();
  try {
    const outcome = await runAutoAlign({
      source,
      calibration: device.cameraCalibration,
      bedWidth: device.bedWidth,
      bedHeight: device.bedHeight,
      planeHeightMm: wizard.planeHeightMm,
    });
    if (!isCurrent()) return;
    cleanup();
    if (outcome.kind === 'ok') {
      // No await between the final owner check and these synchronous writes.
      useStore.getState().updateDeviceProfile({ cameraAlignment: outcome.alignment });
      camera.setSurfaceHeightMm(wizard.planeHeightMm);
      wizard.setStep({ kind: 'done', basis: outcome.basis });
    } else {
      wizard.setStep({ kind: 'detect', status: { kind: 'failed', message: outcome.message } });
    }
  } catch {
    if (isCurrent()) {
      wizard.setStep({
        kind: 'detect',
        status: { kind: 'failed', message: 'Camera alignment failed. Capture the markers again.' },
      });
    }
  } finally {
    cleanup();
  }
}
