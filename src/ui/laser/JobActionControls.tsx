import type { ReactNode } from 'react';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { Icon } from '../kit/icons';
import { jobTimeNoun } from '../machine/machine-labels';
import { useStore } from '../state';
import {
  cancelOwnedFramePreparation,
  useFramePreparationStore,
  type FramePreparationStage,
} from '../state/frame-preparation-store';
import { actionGridStyle, framedRunStatusStyle, primaryActionStyle } from './JobControls.styles';
import { startJobTitle } from './JobEstimatePresentation';
import { LiveJobTimeBadge } from './LiveJobTimeBadge';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { useExecutionSignatureAppState } from './use-execution-signature-app-state';
import { useFrameAction } from './use-frame-action';
import { useFramedRunLaserState } from './use-framed-run-laser-state';
import { useJobEstimate } from './use-job-estimate';

type Props = {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onStartJob: () => void;
  readonly docked?: boolean;
  readonly children?: ReactNode;
};

/** One readiness/estimate subscription, mounted either inline or in the workspace dock. */
export function JobActionControls(props: Props): JSX.Element {
  const model = useJobActionModel(props);
  const status = (
    <span
      role="status"
      aria-busy={model.preparingFrame}
      className={props.docked ? 'lf-job-dock__readiness' : undefined}
      style={props.docked ? undefined : framedRunStatusStyle}
      title={model.framedRunIssue ?? undefined}
    >
      {model.statusText}
      {model.cancellablePreparation && (
        <button
          type="button"
          className="lf-btn"
          onClick={cancelOwnedFramePreparation}
          title="Stop preparing this Frame. Nothing has been sent to the machine."
        >
          Cancel
        </button>
      )}
    </span>
  );
  const estimate = <LiveJobTimeBadge estimate={model.estimate} />;
  const actions = (
    <div style={actionGridStyle} className={props.docked ? 'lf-job-dock__buttons' : undefined}>
      <JobActionButtons model={model} onStartJob={props.onStartJob} docked={props.docked} />
      {props.children}
    </div>
  );
  if (props.docked) {
    return (
      <>
        <div className="lf-job-dock__status" data-ready={model.framedReady}>
          {status}
          <span className="lf-job-dock__estimate">{estimate}</span>
        </div>
        {actions}
      </>
    );
  }
  return (
    <>
      {actions}
      {status}
      {estimate}
    </>
  );
}

function useJobActionModel(props: { readonly disabled: boolean; readonly streaming: boolean }) {
  const onFrame = useFrameAction();
  // Watch only the fields used by exact-artifact readiness. Pointer movement and
  // controller poll bookkeeping must not repeat the comparison or estimation.
  const app = useExecutionSignatureAppState();
  const laser = useFramedRunLaserState();
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const estimate = useJobEstimate();
  const framePending = useFramePreparationStore((state) => state.pending);
  const progress = useFramePreparationStore((state) => state.progress);
  const stage = useFramePreparationStore((state) => state.stage);
  const cancellable = useFramePreparationStore((state) => state.cancellable);
  const frameActive = laser.motionOperation?.kind === 'frame';
  const preparingFrame = framePending && !frameActive;
  const busy = props.disabled || props.streaming || framePending;
  const framedRunIssue = framedRunReadinessIssue(laser.framedRun, app, laser);
  const framedReady = framedRunIssue === null;
  return {
    onFrame,
    framedRunIssue,
    framedReady,
    preparingFrame,
    cancellablePreparation: preparingFrame && cancellable,
    frameControl: frameControlProps(busy, laser.statusReport?.state),
    startLabel: framedReady ? 'Start framed job' : 'Set up & Frame',
    frameLabel: preparingFrame ? 'Preparing Frame…' : framedReady ? 'Frame again' : 'Frame job',
    startControl: {
      disabled: busy,
      title: framedReady
        ? startJobTitle(estimate, jobTimeNoun(machineKind))
        : 'Prepare and Frame the exact job with the tool off. After a clean Frame, press Start again to review and run.',
    },
    statusText: framedRunStatusText({
      frameActive,
      stage,
      framedReady,
      hasFramedRun: laser.framedRun !== null,
      framedRunIssue,
      preparingFrame,
      progress,
    }),
    estimate,
  };
}

function JobActionButtons(props: {
  readonly model: ReturnType<typeof useJobActionModel>;
  readonly onStartJob: () => void;
  readonly docked: boolean | undefined;
}): JSX.Element {
  const { model, docked } = props;
  const frame = (
    <button
      type="button"
      className={docked ? 'lf-btn' : 'lf-btn lf-btn--go'}
      onClick={model.onFrame}
      disabled={model.frameControl.disabled}
      title={model.frameControl.title}
    >
      {docked && <Icon name="fit-bed" size={18} />}
      {model.frameLabel}
    </button>
  );
  const start = (
    <button
      type="button"
      className={docked ? 'lf-btn lf-job-dock__start' : 'lf-btn lf-btn--go'}
      style={docked ? undefined : primaryActionStyle}
      onClick={props.onStartJob}
      disabled={model.startControl.disabled}
      title={model.startControl.title}
    >
      {docked && <Icon name="play" size={18} />}
      {model.startLabel}
    </button>
  );
  return docked ? (
    <>
      {frame}
      {start}
    </>
  ) : (
    <>
      {start}
      {frame}
    </>
  );
}

function framedRunStatusText(args: {
  readonly frameActive: boolean;
  readonly stage: FramePreparationStage;
  readonly framedReady: boolean;
  readonly hasFramedRun: boolean;
  readonly framedRunIssue: string | null;
  readonly preparingFrame: boolean;
  readonly progress: OutputCompilationProgress | null;
}): string {
  if (args.frameActive) {
    // A split Frame traces the compiled outline while the exact program is
    // still being prepared (ADR-353); no permit exists until it arrives.
    return args.stage === 'tracing'
      ? 'Framing the job outline — the exact job is still being prepared…'
      : 'Framing exact job…';
  }
  if (args.preparingFrame) return preparingFrameStatusText(args.progress, args.stage);
  if (args.framedReady) return 'Ready to start — framed job unchanged';
  if (!args.hasFramedRun) return 'Not framed — prepare and Frame this job first';
  return `Frame expired — ${args.framedRunIssue}`;
}

function frameControlProps(busy: boolean, state: string | undefined) {
  const ready = state === 'Idle';
  return {
    disabled: busy || !ready,
    title: ready
      ? "Trace the exact job's full generated motion envelope with the tool off. After a clean Frame, press Start to review and run."
      : frameBlockedTitle(state),
  };
}

// Compiler phases as the operator experiences them, not as the pipeline names
// them. Numeric progress only arrives for jobs the compiler fans out (CNC
// regions); every other preparation reads the phase alone, and the phase-less
// wording covers the seconds before the first report.
const PREPARING_PHASE_TEXT: Record<OutputCompilationProgress['phase'], string> = {
  normalizing: 'reading shapes',
  planning: 'planning toolpaths',
  merging: 'merging results',
  finalizing: 'finishing',
};

function preparingFrameStatusText(
  progress: OutputCompilationProgress | null,
  stage: FramePreparationStage,
): string {
  const lead =
    stage === 'finishing'
      ? 'Frame traced — finishing the exact job before Start is authorized'
      : 'Preparing the exact job for Frame';
  if (progress === null) return `${lead}…`;
  const phase = PREPARING_PHASE_TEXT[progress.phase];
  if (progress.total <= 0) return `${lead} — ${phase}…`;
  return `${lead} — ${phase} ${progress.completed}/${progress.total}…`;
}

function frameBlockedTitle(state: string | undefined): string {
  if (state === undefined) return 'Wait for an Idle status report before framing.';
  return `Machine must be Idle before framing (currently ${state}).`;
}
