// A nudge photo and its Fix belong to one wizard/document/camera context.
// Keep the owner above the wizard's minimize/expand presentation, as for a
// regular calibration photo. A context that went away never becomes valid again.
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { cameraBedFrameNow } from '../camera-bed-frame-now';
import { useCameraCalibrationStore, type CalibrationStep } from './camera-calibration-store';
import { applyNudge, photographNudgeRing } from './nudge-actions';

export type NudgePhotoControls = {
  readonly take: () => Promise<void>;
  readonly apply: (offset: Vec2) => boolean;
};
type NudgeRun = {
  readonly controller: AbortController;
  readonly ownsContext: () => boolean;
  step: CalibrationStep;
};
type RunRef = MutableRefObject<NudgeRun | null>;
const CHANGED = 'The camera, document or calibration changed. Take a new photo before fixing it.';

export function useNudgePhoto(): NudgePhotoControls {
  const runRef = useRef<NudgeRun | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const retire = (): void => {
      const run = runRef.current;
      if (run !== null && !isCurrent(runRef, run)) discard(runRef);
    };
    const stops = [
      useStore.subscribe(retire),
      useCameraStore.subscribe(retire),
      useLaserStore.subscribe(retire),
      useCameraCalibrationStore.subscribe(retire),
    ];
    return () => {
      mounted.current = false;
      stops.forEach((stop) => stop());
      discard(runRef);
    };
  }, []);

  const take = async (): Promise<void> => {
    const app = useStore.getState();
    const camera = useCameraStore.getState();
    const wizard = useCameraCalibrationStore.getState();
    if (
      !mounted.current ||
      !wizard.open ||
      wizard.mode !== 'nudge' ||
      camera.sourceState.kind !== 'live'
    )
      return;
    discard(runRef);
    const bedFrame = JSON.stringify(cameraBedFrameNow());
    const run: NudgeRun = {
      controller: new AbortController(),
      ownsContext: () => {
        const now = useStore.getState();
        const source = useCameraStore.getState();
        return (
          now.projectDocumentEpoch === app.projectDocumentEpoch &&
          now.project.device === app.project.device &&
          source.sourceEpoch === camera.sourceEpoch &&
          source.sourceState === camera.sourceState &&
          useCameraCalibrationStore.getState().settings === wizard.settings &&
          JSON.stringify(cameraBedFrameNow()) === bedFrame
        );
      },
      step: { kind: 'nudge-photo', status: { kind: 'running' } },
    };
    runRef.current = run;
    wizard.setStep(run.step);
    try {
      const outcome = await photographNudgeRing({
        source: camera.sourceState.source,
        sheetThicknessMm: wizard.settings.sheetThicknessMm,
        signal: run.controller.signal,
      });
      publish(
        runRef,
        run,
        outcome.kind === 'ok'
          ? { kind: 'nudge-result', offsetMm: outcome.offsetMm }
          : { kind: 'nudge-photo', status: { kind: 'failed', message: outcome.message } },
      );
    } catch (error: unknown) {
      publish(runRef, run, {
        kind: 'nudge-photo',
        status: {
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };
  return {
    take,
    apply: (offset) => applyCurrentNudge(runRef, offset),
  };
}

function applyCurrentNudge(ref: RunRef, offset: Vec2): boolean {
  const run = ref.current;
  if (
    run === null ||
    run.step.kind !== 'nudge-result' ||
    run.step.offsetMm !== offset ||
    !isCurrent(ref, run)
  )
    return false;
  // Our own profile write notifies the context subscriptions synchronously.
  ref.current = null;
  return applyNudge(offset);
}

function isCurrent(ref: RunRef, run: NudgeRun): boolean {
  const wizard = useCameraCalibrationStore.getState();
  return (
    ref.current === run &&
    !run.controller.signal.aborted &&
    wizard.open &&
    wizard.mode === 'nudge' &&
    wizard.step === run.step &&
    run.ownsContext()
  );
}
function discard(ref: RunRef): void {
  const run = ref.current;
  if (run === null) return;
  ref.current = null;
  run.controller.abort();
  const wizard = useCameraCalibrationStore.getState();
  if (wizard.open && wizard.mode === 'nudge' && wizard.step === run.step)
    wizard.setStep({ kind: 'nudge-photo', status: { kind: 'failed', message: CHANGED } });
}
function publish(ref: RunRef, run: NudgeRun, step: CalibrationStep): void {
  if (!isCurrent(ref, run)) return;
  run.step = step;
  useCameraCalibrationStore.getState().setStep(step);
}
