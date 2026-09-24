// Preview and Submit share one preparation, including decode and debounce.
import { type Ref, useEffect, useRef, useState } from 'react';
import type { ColoredPath } from '../../core/scene';
import type { TracePhase } from '../../core/trace/trace-progress';
import {
  type RawImageData,
  type TraceBoundary,
  type TraceOptions,
  coloredPathsToSvg,
} from '../../core/trace';
import type { PreparedTrace, TracePreparationRequest } from './prepared-trace';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import { traceBoundaryForWorkingGrid, type TraceGrid } from './trace-boundary-grid';
import { isTraceRequestSuperseded } from './use-trace-worker-client';
import type { TraceNotice } from './trace-notices';
import {
  useTracePreviewSettlement,
  type TracePreviewCommitControl,
} from './use-trace-preview-settlement';
import type { TracePreparation } from './trace-preparation';
import {
  beginTracePreview,
  decodeTraceSource,
  readyPreparedPreview,
  type DecodedSource,
} from './trace-preview-preparation';

export type TracePreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding'; readonly startedAt?: number }
  | {
      readonly kind: 'tracing';
      readonly phase?: TracePhase;
      readonly startedAt?: number;
      readonly sourceHasTransparency?: boolean | undefined;
    }
  | {
      readonly kind: 'ready';
      readonly svg: string;
      readonly width: number;
      readonly height: number;
      readonly paths: ReadonlyArray<ColoredPath>;
      readonly preparedTrace?: PreparedTrace;
      readonly notices?: ReadonlyArray<TraceNotice>;
      readonly sourceHasTransparency?: boolean | undefined;
    }
  | { readonly kind: 'error'; readonly message: string };

export function useTracePreview(
  file: File | null,
  options: TraceOptions,
  boundary?: TraceBoundary | null,
  boundaryMode: BoundaryMode = 'crop',
  sourceGrid?: TraceGrid,
  commitControl?: Ref<TracePreviewCommitControl>,
): TracePreviewState {
  const [state, setState] = useState<TracePreviewState>({ kind: 'idle' });
  const decodedRef = useRef<DecodedSource | null>(null);
  const preparationRef = useRef<TracePreparation>();
  const tokenRef = useRef(0);
  const sourceWidth = sourceGrid?.width,
    sourceHeight = sourceGrid?.height;
  const request: TracePreparationRequest | null =
    file === null
      ? null
      : {
          file,
          options,
          boundary: boundary ?? null,
          boundaryMode,
          ...(sourceGrid === undefined ? {} : { sourceGrid }),
        };
  const settledToken = useTracePreviewSettlement(commitControl, {
    request,
    sourceGrid: sourceGrid ?? null,
    token: tokenRef,
    setState,
    sourceHasTransparency: () => decodedRef.current?.decoded?.hasTransparency,
    preparation: () =>
      preparationRef.current?.failed === true ? undefined : preparationRef.current,
    settlePreparation: (outcome) => preparationRef.current?.settle(outcome),
    readyPreview: (request, result, transparent) =>
      readyPreparedPreview(decodedRef.current, request, result, transparent),
  });
  useEffect(() => {
    if (file === null) {
      decodedRef.current = null;
      return undefined;
    }
    const source = decodeTraceSource(file);
    decodedRef.current = source;
    return () => {
      source.cache.clear();
      source.controller.abort();
    };
  }, [file]);
  useEffect(() => {
    const currentRequest: TracePreparationRequest | null =
      file === null
        ? null
        : {
            file,
            options,
            boundary: boundary ?? null,
            boundaryMode,
            ...(sourceWidth === undefined || sourceHeight === undefined
              ? {}
              : { sourceGrid: { width: sourceWidth, height: sourceHeight } }),
          };
    return beginTracePreview(currentRequest, {
      decoded: decodedRef,
      preparation: preparationRef,
      token: tokenRef,
      settled: settledToken,
      setState,
    });
  }, [file, options, boundary, boundaryMode, sourceWidth, sourceHeight, settledToken]);
  return state;
}
export function runTrace(args: {
  readonly img: RawImageData;
  readonly options: TraceOptions;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly sourceGrid?: TraceGrid | null;
  readonly sourceHasTransparency?: boolean | undefined;
  readonly request?: TracePreparationRequest;
  readonly isCurrent: () => boolean;
  readonly setState: (next: TracePreviewState) => void;
  readonly signal?: AbortSignal;
}): Promise<void> {
  // Trace is async — runs in the Worker if available, otherwise inline. A slow
  // trace can resolve AFTER a newer one has started; isCurrent() re-checks the
  // latest-call token AFTER the await so a stale result never clobbers the newer
  // preview's ready/error state (P2-A). Returns the promise so tests can await it.
  return (async () => {
    try {
      const workingBoundary = traceBoundaryForWorkingGrid(args.boundary, args.sourceGrid, args.img);
      const result = await traceImageWithBoundaryMode(
        args.img,
        args.options,
        workingBoundary,
        args.boundaryMode ?? 'crop',
        args.signal,
      );
      const { paths, width, height } = result;
      if (!args.isCurrent()) return;
      const svg = coloredPathsToSvg(paths, width, height, undefined, args.options.traceMode);
      args.setState({
        kind: 'ready',
        svg,
        width,
        height,
        paths,
        ...(result.notices === undefined ? {} : { notices: result.notices }),
        ...(args.request === undefined ? {} : { preparedTrace: { request: args.request, result } }),
        sourceHasTransparency: args.sourceHasTransparency,
      });
    } catch (err) {
      if (isTraceRequestSuperseded(err)) return;
      if (!args.isCurrent()) return;
      args.setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
