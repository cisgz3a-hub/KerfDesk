import { useStore } from '../state/store';
import { workspaceReadProjection } from '../remote-control/authoring-projections';
import {
  redactReviewProjection,
  releaseReviewProjection,
} from '../remote-control/status-projections';
import type {
  RemoteCommandResult,
  RemoteControlOptions,
  RemoteErrorCode,
} from '../remote-control/types';
import { RemoteFault } from '../remote-control/fault';

const READS = new Set([
  'get_workspace',
  'get_workspace_preview',
  'list_fonts',
  'get_text',
  'get_machine',
  'get_app_status',
  'list_material_recipes',
  'review_job',
]);

/** Last synchronous fence before JSON serialization into the native completion route. */
export function remoteDeliveryResult(
  command: string,
  result: RemoteCommandResult,
  signal: AbortSignal,
  currentRevision: string,
  options: RemoteControlOptions,
): RemoteCommandResult {
  // A committed write retains its authoritative receipt even after cancellation.
  if (!READS.has(command) || !result.ok) return result;
  if (signal.aborted) return refused(result.revision, 'cancelled');
  if (result.revision !== currentRevision) return refused(currentRevision, 'stale_revision');
  const sharing = options.canShareArtwork?.() === true;
  if (!sharing && rawArtworkResult(command, result.data))
    return refused(result.revision, 'unavailable');
  if (command === 'get_workspace' && !sharing)
    return {
      ...result,
      data: workspaceReadProjection((options.store ?? useStore).getState(), options),
    };
  if (command === 'review_job')
    return { ...result, data: redactReviewProjection(result.data, options) };
  return result;
}
function rawArtworkResult(command: string, data: Readonly<Record<string, unknown>>): boolean {
  return (
    command === 'get_text' || (command === 'get_workspace_preview' && data['status'] !== 'disabled')
  );
}
function refused(revision: string, code: RemoteErrorCode): RemoteCommandResult {
  return { ok: false, revision, error: { code, message: new RemoteFault(code).message } };
}
export function releaseRemoteDelivery(
  command: string,
  result: RemoteCommandResult | undefined,
): void {
  if (command === 'review_job' && result?.ok === true) releaseReviewProjection(result.data);
}
