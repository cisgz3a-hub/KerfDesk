import { useImperativeHandle, useRef, type MutableRefObject, type Ref } from 'react';
import { coloredPathsToSvg } from '../../core/trace';
import type { PreparedTrace, TracePreparationRequest } from './prepared-trace';
import type { TraceGrid } from './trace-boundary-grid';
import type { TracePreviewState } from './use-trace-preview';
import { isTraceRequestSuperseded, type TraceResult } from './use-trace-worker-client';

export type TracePreviewSettlement =
  | { readonly kind: 'ready'; readonly result: TraceResult }
  | { readonly kind: 'error'; readonly error: unknown };
export type TracePreviewCommitControl = {
  readonly capture: () => (outcome: TracePreviewSettlement) => void;
};
type PreviewOwner = {
  readonly request: TracePreparationRequest | null;
  readonly sourceGrid: TraceGrid | null;
  readonly token: MutableRefObject<number>;
  readonly sourceHasTransparency: () => boolean | undefined;
  readonly setState: (state: TracePreviewState) => void;
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
      capture: () => {
        const captured = latest.current,
          token = captured.token.current,
          epoch = ++submission.current;
        let completed = false;
        return (outcome) => {
          if (
            completed ||
            epoch !== submission.current ||
            token !== latest.current.token.current ||
            !sameOwner(captured, latest.current)
          )
            return;
          if (outcome.kind === 'error' && isTraceRequestSuperseded(outcome.error)) return;
          if (captured.request === null) return;
          completed = true;
          settled.current = token;
          captured.setState(
            outcome.kind === 'ready'
              ? readyTracePreview(
                  captured.request,
                  outcome.result,
                  captured.sourceHasTransparency(),
                )
              : {
                  kind: 'error',
                  message:
                    outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
                },
          );
        };
      },
    }),
    [],
  );
  return settled;
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

function readyTracePreview(
  request: TracePreparationRequest,
  result: TraceResult,
  sourceHasTransparency: boolean | undefined,
): TracePreviewState {
  return {
    kind: 'ready',
    svg: coloredPathsToSvg(result.paths, result.width, result.height),
    paths: result.paths,
    width: result.width,
    height: result.height,
    preparedTrace: { request, result },
    ...(result.notices === undefined ? {} : { notices: result.notices }),
    sourceHasTransparency,
  };
}
