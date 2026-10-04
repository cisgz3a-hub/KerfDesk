import type { AppState } from '../state/store';
import type { LaserState } from '../state/laser-store';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { currentOutputScope } from '../state/output-scope-state';
import { prepareCurrentStartJob } from '../laser/start-job-source';
import { isOutputPreparationAbort } from '../laser/output-preparation-errors';
import { modelFor, type ReviewedStartBundle } from '../laser/job-review/job-review-gate';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import { RemoteFault } from '../remote-control/fault';
import { ownRemoteReviewPreparation } from './job-review-preparation-owner';

type RemotePreparation =
  | {
      readonly ok: true;
      readonly bundle: ReviewedStartBundle;
      readonly model: JobReviewModel;
      readonly machineInputsKey: string;
    }
  | {
      readonly ok: false;
      readonly status: 'unavailable' | 'preparing';
      readonly messages: readonly string[];
    };
let active: symbol | null = null;
const CHANGED =
  'The job or machine setup changed during review preparation. Request a fresh review.';

/** Use the ordinary compile/placement owner, without a dialog or any controller operation. */
export async function prepareRemoteJobReview(
  app: AppState,
  laser: LaserState,
  signal?: AbortSignal,
): Promise<RemotePreparation> {
  if (callerCancelled(signal)) throw new RemoteFault('cancelled');
  if (active !== null)
    return {
      ok: false,
      status: 'preparing',
      messages: ['A remote job review is already being prepared. Request it again shortly.'],
    };
  const token = Symbol('remote-review-preparation');
  active = token;
  const owner = ownRemoteReviewPreparation(app, laser, signal);
  try {
    const prepared = await prepareCurrentStartJob(
      app,
      laser,
      owner.camera,
      undefined,
      false,
      owner.signal,
    );
    if (callerCancelled(signal)) throw new RemoteFault('cancelled');
    if (!owner.current()) return { ok: false, status: 'unavailable', messages: [CHANGED] };
    if (!prepared.ok) return { ok: false, status: 'unavailable', messages: prepared.messages };
    const bundle: ReviewedStartBundle = {
      app,
      project: app.project,
      laser,
      prepared,
      laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      outputScope: currentOutputScope(app),
      preparedMachineInputsKey: owner.machineKey,
    };
    const model = modelFor(bundle);
    if (!owner.current()) return { ok: false, status: 'unavailable', messages: [CHANGED] };
    return { ok: true, bundle, model, machineInputsKey: owner.machineKey };
  } catch (error) {
    if (cancelledPreparation(error, signal)) throw new RemoteFault('cancelled');
    if (isOutputPreparationAbort(error) || owner.signal.aborted)
      return { ok: false, status: 'unavailable', messages: [CHANGED] };
    return {
      ok: false,
      status: 'unavailable',
      messages: ['The current job could not be prepared. Check its review on the PC.'],
    };
  } finally {
    owner.dispose();
    if (active === token) active = null;
  }
}

function callerCancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}
function cancelledPreparation(error: unknown, signal?: AbortSignal): boolean {
  return callerCancelled(signal) || error instanceof RemoteFault;
}
