import type { LaserState } from '../state/laser-store';
import { memoizeOnInputs } from '../state/memoize-on-inputs';
import {
  nativeBedEvidenceSnapshot,
  selectNativeBedEvidence,
  type NativeBedEvidence,
} from '../state/native-bed-frame';

export type CanvasRevisionSource = Pick<
  LaserState,
  | 'statusReport'
  | 'connection'
  | 'capabilities'
  | 'controllerSettings'
  | 'workOriginActive'
  | 'trustedPositionEpoch'
  | 'wcoCache'
  | 'homingState'
> &
  Required<NativeBedEvidence>;

/** Every machine field the idle canvas plan depends on, as one comparable key. */
export function deriveCanvasMachineRevision(state: CanvasRevisionSource): string {
  const report = state.statusReport;
  const position =
    report === null
      ? 'unknown'
      : report.state === 'Idle'
        ? `idle:${axisKey(report.mPos)}:${axisKey(report.wPos)}:${axisKey(report.wco)}`
        : `busy:${report.state}`;
  return [
    state.connection.kind,
    state.capabilities.statusQuery,
    state.controllerSettings?.reportInches === true ? 'in' : 'mm',
    state.workOriginActive ? 'origin' : 'machine',
    String(state.trustedPositionEpoch ?? 0),
    axisKey(state.wcoCache),
    // The snapshot forwards homingState (ADR-327); confirmHome flips it without
    // touching any other keyed field, so it must key the revision too.
    state.homingState,
    JSON.stringify(nativeBedEvidenceSnapshot(state)),
    position,
  ].join('|');
}

// The canvas subscribes with this selector, so it runs on every laser-store set:
// ~3 per acknowledged line while a job streams, when none of these fields moves.
// Rebuild the key only when a field it reads changes (a status poll, at most).
export const canvasMachineRevision = memoizeOnInputs(
  (state: CanvasRevisionSource) => [
    state.statusReport,
    state.connection.kind,
    state.capabilities.statusQuery,
    state.controllerSettings,
    state.workOriginActive,
    state.trustedPositionEpoch,
    state.wcoCache,
    state.homingState,
    selectNativeBedEvidence(state),
  ],
  deriveCanvasMachineRevision,
);

function axisKey(
  axis: { readonly x: number; readonly y: number; readonly z: number } | null,
): string {
  if (axis === null) return '-';
  return `${axis.x.toFixed(3)},${axis.y.toFixed(3)},${axis.z.toFixed(3)}`;
}
