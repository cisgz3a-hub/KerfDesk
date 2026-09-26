// One photo and its review belong to the exact document, profile, camera and
// settings that requested them. The owner lives above the minimize/expand
// presentation, and remains current until Save or explicit abandonment.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { photographTarget } from './calibration-actions';
import {
  useCameraCalibrationStore,
  type CalibrationResult,
  type CalibrationStep,
} from './camera-calibration-store';

export type CalibrationPhotoControls = {
  readonly take: () => Promise<void>;
  readonly cancel: () => void;
  readonly save: (result: CalibrationResult) => void;
};

type PhotoRun = {
  readonly controller: AbortController;
  readonly ownsContext: () => boolean;
  step: CalibrationStep;
};
type RunRef = MutableRefObject<PhotoRun | null>;

export function useCalibrationPhoto(): CalibrationPhotoControls {
  const runRef = useRef<PhotoRun | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const retireStale = (): void => {
      const run = runRef.current;
      if (run !== null && !isCurrent(runRef, run)) discard(runRef);
    };
    const offApp = useStore.subscribe(retireStale);
    const offCamera = useCameraStore.subscribe(retireStale);
    const offWizard = useCameraCalibrationStore.subscribe(retireStale);
    return () => {
      mounted.current = false;
      offApp();
      offCamera();
      offWizard();
      discard(runRef);
    };
  }, []);

  const take = async (): Promise<void> => {
    const camera = useCameraStore.getState();
    const app = useStore.getState();
    const wizard = useCameraCalibrationStore.getState();
    if (!mounted.current || !wizard.open || camera.sourceState.kind !== 'live') return;
    discard(runRef);
    const run: PhotoRun = {
      controller: new AbortController(),
      ownsContext: () => {
        const current = useStore.getState();
        const source = useCameraStore.getState();
        return (
          current.projectDocumentEpoch === app.projectDocumentEpoch &&
          current.project.device === app.project.device &&
          source.sourceEpoch === camera.sourceEpoch &&
          source.sourceState === camera.sourceState &&
          useCameraCalibrationStore.getState().settings === wizard.settings
        );
      },
      step: { kind: 'photo', status: { kind: 'running' } },
    };
    runRef.current = run;
    wizard.setStep(run.step);
    try {
      const outcome = await photographTarget({
        source: camera.sourceState.source,
        settings: wizard.settings,
        bedWidthMm: app.project.device.bedWidth,
        bedHeightMm: app.project.device.bedHeight,
        signal: run.controller.signal,
      });
      publish(
        runRef,
        run,
        outcome.kind === 'ok'
          ? { kind: 'result', result: outcome.result }
          : { kind: 'photo', status: { kind: 'failed', message: outcome.message } },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      publish(runRef, run, { kind: 'photo', status: { kind: 'failed', message } });
    }
  };
  return {
    take,
    cancel: () => discard(runRef),
    save: (result) => saveCurrent(runRef, result),
  };
}

function isCurrent(runRef: RunRef, run: PhotoRun): boolean {
  const wizard = useCameraCalibrationStore.getState();
  return (
    runRef.current === run &&
    !run.controller.signal.aborted &&
    wizard.open &&
    wizard.step === run.step &&
    run.ownsContext()
  );
}

function discard(runRef: RunRef): void {
  const run = runRef.current;
  if (run === null) return;
  runRef.current = null;
  run.controller.abort();
  const wizard = useCameraCalibrationStore.getState();
  if (wizard.step === run.step) wizard.setStep({ kind: 'photo', status: { kind: 'idle' } });
}

function publish(runRef: RunRef, run: PhotoRun, step: CalibrationStep): void {
  if (!isCurrent(runRef, run)) return;
  run.step = step;
  useCameraCalibrationStore.getState().setStep(step);
}

function saveCurrent(runRef: RunRef, result: CalibrationResult): void {
  const run = runRef.current;
  if (
    run === null ||
    run.step.kind !== 'result' ||
    run.step.result !== result ||
    !isCurrent(runRef, run)
  )
    return;
  // Release before our own profile update notifies the context listeners.
  runRef.current = null;
  useStore.getState().updateDeviceProfile({ cameraModel: result.record });
  useCameraStore.getState().setOverlayVisible(true);
  useCameraCalibrationStore.getState().closeWizard();
}
