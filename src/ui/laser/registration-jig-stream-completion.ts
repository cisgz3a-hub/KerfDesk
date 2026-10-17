import type { StreamerState } from '../../core/controllers/grbl';
import type { Job } from '../../core/job';
import {
  findRegistrationBoxes,
  machineKindOf,
  REGISTRATION_LAYER_ID,
  registrationRunState,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { settledCleanly } from '../state/post-job-clean-settle';
import type { RunId } from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { variableStreamOutcome } from './variable-stream-advancement';

let cancelObserver: (() => void) | null = null;
type JigCompletionObserver = { readonly accept: () => void; readonly cancel: () => void };

/** Ordinary complete-outline jobs only. Observe before handoff so a short run
 * may settle before acceptance, using the recovery ledger's completion rule. */
export function armRegistrationJigCompletion(args: {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly job: Job;
  readonly runId: RunId;
}): JigCompletionObserver | null {
  cancelRegistrationJigCompletion();
  const app = useStore.getState();
  if (!isWholeOutlineJob(args) || !sameProjectGeometry(app.project, args.project)) return null;
  const documentEpoch = app.projectDocumentEpoch;
  const placement = app.jobPlacement;
  const initial = useLaserStore.getState();
  let streamEpoch: number | null = null;
  let previous: StreamerState | null = null;
  let priorState: LaserState | undefined;
  let accepted = false;
  let successful = false;
  let cancelled = false;
  let unsubscribe = (): void => undefined;
  const cancel = (): void => {
    cancelled = true;
    unsubscribe();
    if (cancelObserver === cancel) cancelObserver = null;
  };
  const finish = (): void => {
    if (!accepted || !successful || cancelled) return;
    cancel();
    publishArtworkSelection(
      args.project,
      documentEpoch,
      placement,
      initial,
      streamEpoch,
      args.runId,
    );
  };
  cancelObserver = cancel;
  unsubscribe = useLaserStore.subscribe((state) => {
    // A prior completed run ID remains in state. Ignore its idle/start-arming
    // updates until this stream is created, as the variable observer does.
    if (
      streamEpoch === null &&
      state.streamerEpoch === initial.streamerEpoch &&
      state.controllerSessionEpoch === initial.controllerSessionEpoch
    )
      return;
    if (streamOwnerChanged(state, initial, streamEpoch, args.runId)) {
      cancel();
      return;
    }
    const current = state.streamer;
    if (streamEpoch === null) {
      if (state.activeRunId !== args.runId || current === null) return;
      streamEpoch = state.streamerEpoch;
    }
    const prior = priorState;
    priorState = state;
    if (current === previous) return;
    const cleanRelease = previous !== null && settledCleanly(state, prior, previous.status);
    const outcome = variableStreamOutcome(previous, current, cleanRelease);
    previous = current;
    if (outcome === 'failed') cancel();
    if (outcome === 'successful') {
      successful = true;
      finish();
    }
  });
  return {
    accept: () => {
      accepted = true;
      finish();
    },
    cancel,
  };
}

export function cancelRegistrationJigCompletion(): void {
  cancelObserver?.();
  cancelObserver = null;
}

function streamOwnerChanged(
  state: LaserState,
  initial: LaserState,
  epoch: number | null,
  runId: RunId,
): boolean {
  return (
    state.controllerSessionEpoch !== initial.controllerSessionEpoch ||
    state.streamerEpoch > (epoch ?? initial.streamerEpoch + 1) ||
    (state.activeRunId !== null && state.activeRunId !== runId)
  );
}

function wholeOutput(scope: OutputScope): boolean {
  return !scope.cutSelectedGraphics && !scope.useSelectionOrigin;
}

function isWholeOutlineJob(args: {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly job: Job;
}): boolean {
  const boxes = findRegistrationBoxes(args.project.scene);
  return (
    machineKindOf(args.project.machine) === 'laser' &&
    registrationRunState(args.project.scene) === 'box' &&
    !boxes.some((box) => box.provenance === 'captured-board') &&
    wholeOutput(args.outputScope) &&
    args.job.groups.length > 0 &&
    args.job.groups.every((group) => group.layerId === REGISTRATION_LAYER_ID)
  );
}

// The earlier variable observer may legitimately update variables at settlement.
// Preserve that change while fencing every other project field.
function sameProjectGeometry(current: Project, expected: Project): boolean {
  const { variables: _currentVariables, ...currentFields } = current;
  const { variables: _expectedVariables, ...expectedFields } = expected;
  const keys = Object.keys(currentFields) as Array<keyof typeof currentFields>;
  return (
    keys.length === Object.keys(expectedFields).length &&
    keys.every((key) => currentFields[key] === expectedFields[key])
  );
}

function publishArtworkSelection(
  project: Project,
  documentEpoch: number,
  placement: ReturnType<typeof useStore.getState>['jobPlacement'],
  initial: LaserState,
  streamEpoch: number | null,
  runId: RunId,
): void {
  const current = useStore.getState();
  const laser = useLaserStore.getState();
  if (
    current.projectDocumentEpoch !== documentEpoch ||
    current.jobPlacement !== placement ||
    !sameProjectGeometry(current.project, project) ||
    !wholeOutput(currentOutputScope(current)) ||
    streamOwnerChanged(laser, initial, streamEpoch, runId) ||
    laser.streamerEpoch !== streamEpoch ||
    laser.streamer !== null
  )
    return;
  current.setRegistrationOutput('artwork');
  useToastStore
    .getState()
    .pushToast(
      'Outline finished. Artwork only is now selected. Place the piece inside the outline and set focus for its top surface. Frame if the footprint or placement changed, then Start the artwork.',
      'success',
    );
}
