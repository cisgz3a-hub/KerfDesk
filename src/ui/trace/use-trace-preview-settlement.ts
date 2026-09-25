import { useImperativeHandle, useRef, type MutableRefObject, type Ref } from 'react';
import { coloredPathsToSvg } from '../../core/trace';
import type {
  PendingPreparedTrace,
  PreparedTrace,
  TracePreparationRequest,
} from './prepared-trace';
import type { TraceGrid } from './trace-boundary-grid';
import type { TracePreviewState } from './use-trace-preview';
import { isTraceRequestSuperseded, type TraceResult } from './use-trace-worker-client';
import { isTraceAbort } from './trace-cancellation';
import type { TraceCommitPhase } from './trace-commit-at-grid';

export type TracePreviewSettlement =
  | { readonly kind: 'ready'; readonly result: TraceResult }
  | { readonly kind: 'error'; readonly error: unknown };
/** A settlement, or a finer commit's progress on the captured request: the
 * preview shows the phase until the commit settles it (ADR-401). */
export type TracePreviewCommitUpdate =
  | TracePreviewSettlement
  | { readonly kind: 'progress'; readonly phase: TraceCommitPhase };
export type TracePreviewCommitControl = {
  readonly capture: () => (outcome: TracePreviewCommitUpdate) => void;
  readonly preparation?: () => PendingPreparedTrace | undefined;
};
type PreviewOwner = {
  readonly request: TracePreparationRequest | null;
  readonly sourceGrid: TraceGrid | null;
  readonly token: MutableRefObject<number>;
  readonly sourceHasTransparency: () => boolean | undefined;
  readonly setState: (state: TracePreviewState) => void;
  readonly preparation?: () => PendingPreparedTrace | undefined;
  readonly settlePreparation?: (outcome: TracePreviewSettlement) => void;
  readonly readyPreview?: typeof readyTracePreview;
};

export function preparedTraceEntry(preview: TracePreviewState): {
  readonly preparedTrace?: PreparedTrace;
} {
  return preview.kind === 'ready' && preview.preparedTrace !== undefined
    ? { preparedTrace: preview.preparedTrace }
    : {};
}

/** Capture the currently displayed request at submission. A commit may settle
 * that request without dispatching more work; a newer request/session wins. */
export function useTracePreviewSettlement(
  control: Ref<TracePreviewCommitControl> | undefined,
  owner: PreviewOwner,
): MutableRefObject<number | null> {
  const settled = useRef<number | null>(null),
    latest = useRef(owner),
    submission = useRef(0);
  latest.current = owner;
  useImperativeHandle(
    control,
    () => ({
      preparation: () => latest.current.preparation?.(),
      capture: () => {
        const captured = latest.current,
          token = captured.token.current,
          epoch = ++submission.current;
        // Submit now owns this request, including any pending decode/debounce.
        // A newer request advances the token and remains free to supersede it.
        settled.current = token;
        let completed = false;
        let startedAt: number | undefined;
        const current = (): boolean =>
          !completed &&
          epoch === submission.current &&
          token === latest.current.token.current &&
          sameOwner(captured, latest.current);
        return (outcome) => {
          if (!current()) return;
          if (outcome.kind === 'error' && isTraceRequestSuperseded(outcome.error)) return;
          if (captured.request === null) return;
          if (outcome.kind === 'progress') {
            startedAt ??= Date.now();
            captured.setState(
              commitProgressPreview(outcome.phase, startedAt, captured.sourceHasTransparency()),
            );
            return;
          }
          completed = true;
          settled.current = token;
          captured.settlePreparation?.(outcome);
          captured.setState(
            outcome.kind === 'ready'
              ? (captured.readyPreview ?? readyTracePreview)(
                  captured.request,
                  outcome.result,
                  captured.sourceHasTransparency(),
                )
              : failedTracePreview(outcome.error),
          );
        };
      },
    }),
    [],
  );
  return settled;
}

function commitProgressPreview(
  phase: TraceCommitPhase,
  startedAt: number,
  sourceHasTransparency: boolean | undefined,
): TracePreviewState {
  return phase === 'decoding'
    ? { kind: 'decoding', startedAt }
    : { kind: 'tracing', phase, startedAt, sourceHasTransparency };
}

function failedTracePreview(error: unknown): TracePreviewState {
  return isTraceAbort(error)
    ? { kind: 'idle' }
    : { kind: 'error', message: error instanceof Error ? error.message : String(error) };
}

function sameOwner(a: PreviewOwner, b: PreviewOwner): boolean {
  const x = a.request,
    y = b.request;
  return (
    x !== null &&
    y !== null &&
    x.file === y.file &&
    x.options === y.options &&
    x.boundary === y.boundary &&
    x.boundaryMode === y.boundaryMode &&
    a.sourceGrid?.width === b.sourceGrid?.width &&
    a.sourceGrid?.height === b.sourceGrid?.height
  );
}

export function readyTracePreview(
  request: TracePreparationRequest,
  result: TraceResult,
  sourceHasTransparency: boolean | undefined,
): Extract<TracePreviewState, { kind: 'ready' }> {
  return {
    kind: 'ready',
    svg: coloredPathsToSvg(
      result.paths,
      result.width,
      result.height,
      undefined,
      request.options.traceMode,
    ),
    paths: result.paths,
    width: result.width,
    height: result.height,
    preparedTrace: { request, result },
    ...(result.notices === undefined ? {} : { notices: result.notices }),
    sourceHasTransparency: sourceHasTransparency ?? result.sourceHasTransparency,
  };
}
