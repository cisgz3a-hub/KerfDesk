import { jogAxisSignsForOrigin } from '../../core/devices';
import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { machineKindOf, type Project } from '../../core/scene';
import { stepJogVector, clampJogFeed } from '../laser/jog-control-policy';
import { focusJogReady } from '../laser/FocusJogControls';
import { runFrameNow } from '../laser/use-frame-action';
import { currentCompletedFrame } from '../laser/framed-run-readiness';
import { runFramedPermitStart } from '../laser/start-job-flow';
import { recoveryRepository } from '../state/recovery';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import type { RemoteControlOptions } from './types';
import type { BackgroundMachineAction } from './machine-owned-operation';
import { RemoteFault } from './fault';
import { machineReviewPresenter } from './machine-review-presenter';
import { settledMachineMotion, settledMachineJob } from './machine-settlement';

export type MachineExecutionContext = {
  readonly options: RemoteControlOptions;
  readonly revision: () => string;
  readonly assertOwned: (operation: OwnedMachineOperation) => void;
};
export async function executeMachineOperation(
  input: BackgroundMachineAction,
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
): Promise<void> {
  const owner = executionOwner(operation, context);
  context.assertOwned(operation);
  if (input.command === 'abort_job') return executeAbort(operation);
  if (input.command === 'jog_machine') return executeJog(input, operation, context, owner);
  operation.state = 'preparing';
  if (input.command === 'frame_job') return executeFrame(operation, owner);
  return executeReviewedJob(operation, context, owner);
}
function executionOwner(
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
): MachineExecutionOwner {
  return {
    signal: operation.controller.signal,
    assertCurrent: () => context.assertOwned(operation),
    onMotionOwner: (id) => {
      operation.motionId = id;
      operation.motionSettled = settledMachineMotion(operation);
      void operation.motionSettled.catch(() => undefined);
    },
    onDispatch: () => {
      if (operation.committed === false) operation.committed = null;
      operation.state = 'running';
    },
  };
}
async function executeAbort(operation: OwnedMachineOperation): Promise<void> {
  const before = useLaserStore.getState();
  operation.state = 'running';
  operation.committed = null;
  await before.stopJob();
  const after = useLaserStore.getState();
  const confirmed =
    before.controllerSessionEpoch === after.controllerSessionEpoch &&
    after.statusSequence > before.statusSequence &&
    abortReportsIdle(after);
  operation.state = confirmed ? 'completed' : 'unknown';
  operation.committed = confirmed ? true : null;
  operation.message = confirmed
    ? 'Abort was handled and the controller reports Idle.'
    : 'Abort was requested. The stop is not yet confirmed; check the machine status and the PC.';
}
function abortReportsIdle(state: ReturnType<typeof useLaserStore.getState>): boolean {
  if (state.connection.kind !== 'connected' || state.statusReport?.state !== 'Idle') return false;
  if (
    state.motionOperation !== null ||
    state.controllerOperation !== null ||
    state.safetyNotice !== null
  )
    return false;
  return (
    !state.fireActive &&
    !state.airAssistOn &&
    !['streaming', 'paused', 'tool-change'].includes(state.streamer?.status ?? '')
  );
}
async function executeJog(
  input: Extract<MachineCommand, { readonly command: 'jog_machine' }>,
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
  owner: MachineExecutionOwner,
): Promise<void> {
  const project = (context.options.store ?? useStore).getState().project;
  if (input.args.axis === 'z' && !focusJogReady(project.device, machineKindOf(project.machine)))
    throw new RemoteFault('unsupported_operation');
  if (useLaserStore.getState().capabilities.jog === 'none')
    throw new RemoteFault('unsupported_operation');
  await useLaserStore.getState().jog(remoteJogVector(project, input.args), owner);
  operation.committed = true;
  if (operation.motionSettled === undefined) throw new RemoteFault('unavailable');
  await operation.motionSettled;
  operation.state = 'completed';
}
function remoteJogVector(
  project: Project,
  args: Extract<MachineCommand, { readonly command: 'jog_machine' }>['args'],
) {
  const maximum = deviceForActiveHead(project.device, project.machine).maxFeed;
  const z = args.axis === 'z';
  const feed = clampJogFeed(
    args.feedMmPerMin ?? (z ? 600 : 3000),
    z ? Math.min(maximum, 600) : maximum,
  );
  if (z) return { dz: args.direction * args.distanceMm, feed };
  return stepJogVector(
    { x: args.axis === 'x' ? args.direction : 0, y: args.axis === 'y' ? args.direction : 0 },
    args.distanceMm,
    jogAxisSignsForOrigin(project.device.origin),
    feed,
  );
}
async function executeFrame(
  operation: OwnedMachineOperation,
  owner: MachineExecutionOwner,
): Promise<void> {
  const framed = await runFrameNow({ ...owner, interactiveSetup: false, joinExisting: false });
  if (!framed)
    throw new RemoteFault(operation.controller.signal.aborted ? 'cancelled' : 'unavailable');
  operation.committed = true;
  operation.state = 'completed';
}
async function executeReviewedJob(
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
  owner: MachineExecutionOwner,
): Promise<void> {
  const permit = currentCompletedFrame();
  if (permit === null) throw new RemoteFault('unavailable');
  // Transient camera/second-pass programs retain their separate desktop tool owner.
  if (permit.candidate.authorizationContext !== undefined)
    throw new RemoteFault('unsupported_operation');
  const started = await runFramedPermitStart(permit, recoveryRepository, null, {
    executionOwner: owner,
    presenter: machineReviewPresenter(operation, context.revision, context.options),
    onStartCommitted: (runId, epoch) => {
      operation.committed = null;
      operation.runId = runId;
      operation.streamerEpoch = epoch;
      operation.state = 'running';
      operation.jobSettled = settledMachineJob(operation);
      void operation.jobSettled.catch(() => undefined);
    },
  });
  if (!started)
    throw new RemoteFault(operation.controller.signal.aborted ? 'cancelled' : 'unavailable');
  operation.committed = true;
  if (operation.jobSettled === undefined) throw new RemoteFault('unavailable');
  await operation.jobSettled;
  operation.state = 'completed';
}
