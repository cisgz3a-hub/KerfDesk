// useTracePreview — hook that produces a live SVG preview of how a
// raster image will trace under the current options. Used by
// ImportImageDialog so the user can flip between presets and see the
// result instead of guessing-then-committing.
//
// Preview and commit now share the SAME trace function
// (traceImageWithFallback from use-trace-worker-client), so what the
// user sees in the preview is what they get on Trace — including the
// H3 retry-with-relaxed-preset semantics. The only difference is
// rendering: preview stringifies the ColoredPath[] to SVG for the
// browser to display; commit feeds the same paths to importSvgObject.
//
// Phases (all guarded by the latest-call-wins token so a slow trace
// followed by a fast trace can't show stale output):
//   1. file changes → decode at the preview-size cap once
//   2. options change → re-run traceImageWithFallback on the decoded
//      pixels, debounced 300ms so dragging a slider doesn't thrash
//   3. ColoredPath[] → SVG string via coloredPathsToSvg before the
//      renderer sees it

import {
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ColoredPath } from '../../core/scene';
import {
  type RawImageData,
  type TraceBoundary,
  type TraceOptions,
  coloredPathsToSvg,
} from '../../core/trace';
import { PREVIEW_MAX_EDGE_PX, loadImageAsRawData } from './image-loader';
import type { PreparedTrace, TracePreparationRequest } from './prepared-trace';
import { rawImageHasTransparency } from './raw-image-transparency';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import { traceBoundaryForWorkingGrid, type TraceGrid } from './trace-boundary-grid';
import { isTraceRequestSuperseded } from './use-trace-worker-client';
import type { TraceNotice } from './trace-notices';
import {
  useTracePreviewSettlement,
  type TracePreviewCommitControl,
} from './use-trace-preview-settlement';

export type TracePreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding' }
  | { readonly kind: 'tracing'; readonly sourceHasTransparency?: boolean | undefined }
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

// Debounce interval for option changes. 300ms is long enough that
// rapidly cycling presets doesn't queue 5 traces, and short enough
// that a normal click feels instant.
const DEBOUNCE_MS = 300;

// A decoded preview raster paired with its alpha-scan verdict. The verdict is
// computed once per decode: transparency is invariant per image, and
// re-scanning every pixel (~4M at the preview cap) synchronously on each
// options change — ahead of the trace debounce — stalled slider dragging.
type DecodedPreviewImage = {
  readonly img: RawImageData;
  readonly hasTransparency: boolean;
};

export function useTracePreview(
  file: File | null,
  options: TraceOptions,
  boundary?: TraceBoundary | null,
  boundaryMode: BoundaryMode = 'crop',
  sourceGrid?: TraceGrid,
  commitControl?: Ref<TracePreviewCommitControl>,
): TracePreviewState {
  const [state, setState] = useState<TracePreviewState>({ kind: 'idle' });
  const decodedRef = useRef<DecodedPreviewImage | null>(null);
  // Monotonic token. Each effect run captures its token; on completion
  // it bails if the latest token has advanced — stops slow traces
  // from clobbering a newer "ready" result.
  const tokenRef = useRef(0);
  // Latest-options ref. The file-effect below depends only on `file`
  // (re-decoding on every options change would be wasteful), but the
  // first runTrace after a decode used to capture `options` from
  // closure — i.e. whatever value was current when the file-effect
  // FIRST fired. A user who picks a file before changing the preset
  // saw a trace at the original preset. R-H1 audit finding.
  const optionsRef = useLatest(options);
  const boundaryRef = useLatest<TraceBoundary | null>(boundary ?? null);
  const boundaryModeRef = useLatest<BoundaryMode>(boundaryMode);
  const sourceGridRef = useLatest<TraceGrid | null>(sourceGrid ?? null);
  const settledToken = useTracePreviewSettlement(commitControl, {
    request: file === null ? null : { file, options, boundary: boundary ?? null, boundaryMode },
    sourceGrid: sourceGrid ?? null,
    token: tokenRef,
    setState,
    sourceHasTransparency: () => decodedRef.current?.hasTransparency,
  });

  useEffect(() => {
    const myToken = beginPreviewDecode(file, decodedRef, tokenRef, setState);
    if (file === null || myToken === null) return undefined;
    void decodePreviewFile({
      file,
      myToken,
      decodedRef,
      tokenRef,
      settledToken,
      optionsRef,
      boundaryRef,
      boundaryModeRef,
      sourceGridRef,
      setState,
    });
    return () => {
      tokenRef.current += 1;
    };
    // Read request settings through stable refs. A preset switch is handled
    // below without decoding the same file again.
  }, [file, optionsRef, boundaryRef, boundaryModeRef, sourceGridRef, settledToken]);

  useEffect(() => {
    const decoded = decodedRef.current;
    if (decoded === null || file === null) return undefined;
    tokenRef.current += 1;
    const myToken = tokenRef.current;
    // Decode-time verdict — never re-scan the pixels on an options nudge.
    const sourceHasTransparency = decoded.hasTransparency;
    setState({ kind: 'tracing', sourceHasTransparency });
    const timer = window.setTimeout(() => {
      if (tokenRef.current !== myToken) return;
      if (settledToken.current === myToken) return;
      startPreviewTrace({
        img: decoded.img,
        file,
        options,
        boundary: boundary ?? null,
        boundaryMode,
        sourceGrid: sourceGridRef.current,
        sourceHasTransparency,
        isCurrent: () => tokenRef.current === myToken && settledToken.current !== myToken,
        setState,
      });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    file,
    options,
    boundary,
    boundaryMode,
    sourceGrid?.width,
    sourceGrid?.height,
    sourceGridRef,
    settledToken,
  ]);

  return state;
}

function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function beginPreviewDecode(
  file: File | null,
  decodedRef: MutableRefObject<DecodedPreviewImage | null>,
  tokenRef: MutableRefObject<number>,
  setState: (state: TracePreviewState) => void,
): number | null {
  decodedRef.current = null;
  if (file === null) {
    setState({ kind: 'idle' });
    return null;
  }
  tokenRef.current += 1;
  setState({ kind: 'decoding' });
  return tokenRef.current;
}

async function decodePreviewFile(args: {
  readonly file: File;
  readonly myToken: number;
  readonly decodedRef: MutableRefObject<DecodedPreviewImage | null>;
  readonly tokenRef: MutableRefObject<number>;
  readonly settledToken: MutableRefObject<number | null>;
  readonly optionsRef: MutableRefObject<TraceOptions>;
  readonly boundaryRef: MutableRefObject<TraceBoundary | null>;
  readonly boundaryModeRef: MutableRefObject<BoundaryMode>;
  readonly sourceGridRef: MutableRefObject<TraceGrid | null>;
  readonly setState: Dispatch<SetStateAction<TracePreviewState>>;
}): Promise<void> {
  const { file, myToken, decodedRef, tokenRef, settledToken, setState } = args;
  const isCurrent = (): boolean => tokenRef.current === myToken && settledToken.current !== myToken;
  try {
    const img = await loadImageAsRawData(file, PREVIEW_MAX_EDGE_PX);
    if (tokenRef.current !== myToken) return;
    const sourceHasTransparency = rawImageHasTransparency(img);
    decodedRef.current = { img, hasTransparency: sourceHasTransparency };
    // A commit may finish first. Keep its terminal state while retaining
    // decoded pixels and the alpha verdict for subsequent option edits.
    if (settledToken.current === myToken) {
      setState((current) =>
        current.kind === 'ready' ? { ...current, sourceHasTransparency } : current,
      );
      return;
    }
    setState({ kind: 'tracing', sourceHasTransparency });
    startPreviewTrace({
      img,
      file,
      options: args.optionsRef.current,
      boundary: args.boundaryRef.current,
      boundaryMode: args.boundaryModeRef.current,
      sourceGrid: args.sourceGridRef.current,
      sourceHasTransparency,
      isCurrent,
      setState,
    });
  } catch (err) {
    if (!isCurrent()) return;
    setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function startPreviewTrace(args: {
  readonly img: RawImageData;
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
  readonly sourceGrid: TraceGrid | null;
  readonly sourceHasTransparency: boolean;
  readonly isCurrent: () => boolean;
  readonly setState: (next: TracePreviewState) => void;
}): void {
  void runTrace({
    ...args,
    request: {
      file: args.file,
      options: args.options,
      boundary: args.boundary,
      boundaryMode: args.boundaryMode,
    },
  });
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
      );
      const { paths, width, height } = result;
      if (!args.isCurrent()) return;
      const svg = coloredPathsToSvg(paths, width, height);
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
