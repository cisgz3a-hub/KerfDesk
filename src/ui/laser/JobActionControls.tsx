import type { ReactNode } from 'react';
import { Icon } from '../kit/icons';
import { jobTimeNoun } from '../machine/machine-labels';
import { useStore } from '../state';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { actionGridStyle, framedRunStatusStyle, primaryActionStyle } from './JobControls.styles';
import { startJobTitle } from './JobEstimatePresentation';
import { LiveJobTimeBadge } from './LiveJobTimeBadge';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { useExecutionSignatureAppState } from './use-execution-signature-app-state';
import { useFrameAction } from './use-frame-action';
import { useFramedRunLaserState } from './use-framed-run-laser-state';
import { useJobEstimate } from './use-job-estimate';
import { TutorialButton } from '../tutorials/TutorialButton';

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
      className={props.docked ? 'lf-job-dock__readiness' : undefined}
      style={props.docked ? undefined : framedRunStatusStyle}
      title={model.framedRunIssue ?? undefined}
    >
      {model.statusText}
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
          <TutorialButton tutorialId="frame-start" compact label="Frame & Start" />
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
  const preparingFrame = framePending && laser.motionOperation?.kind !== 'frame';
  const busy = props.disabled || props.streaming || framePending;
  const framedRunIssue = framedRunReadinessIssue(laser.framedRun, app, laser);
  const framedReady = framedRunIssue === null;
  return {
    onFrame,
    framedRunIssue,
    framedReady,
    frameControl: frameControlProps(busy, laser.statusReport?.state),
    startLabel: framedReady ? 'Start framed job' : 'Set up & Frame',
    frameLabel: preparingFrame ? 'Preparing Frame…' : framedReady ? 'Frame again' : 'Frame job',
    startControl: {
      disabled: busy,
      title: framedReady
        ? startJobTitle(estimate, jobTimeNoun(machineKind))
        : 'Prepare and Frame the exact job with the tool off. After a clean Frame, press Start again to review and run.',
    },
    statusText: framedRunStatusText(
      laser.motionOperation?.kind === 'frame',
      framedReady,
      laser.framedRun !== null,
      framedRunIssue,
      preparingFrame,
    ),
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

function framedRunStatusText(
  frameOperationActive: boolean,
  framedReady: boolean,
  hasFramedRun: boolean,
  framedRunIssue: string | null,
  preparingFrame: boolean,
): string {
  if (frameOperationActive) return 'Framing exact job…';
  if (preparingFrame) return 'Preparing the exact job for Frame…';
  if (framedReady) return 'Ready to start — framed job unchanged';
  if (!hasFramedRun) return 'Not framed — prepare and Frame this job first';
  return `Frame expired — ${framedRunIssue}`;
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

function frameBlockedTitle(state: string | undefined): string {
  if (state === undefined) return 'Wait for an Idle status report before framing.';
  return `Machine must be Idle before framing (currently ${state}).`;
}
