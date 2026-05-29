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

import { useEffect, useRef, useState } from 'react';
import { type RawImageData, type TraceOptions, coloredPathsToSvg } from '../../core/trace';
import { PREVIEW_MAX_EDGE_PX, loadImageAsRawData } from './image-loader';
import { traceImageWithFallback } from './use-trace-worker-client';

export type TracePreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding' }
  | { readonly kind: 'tracing' }
  | {
      readonly kind: 'ready';
      readonly svg: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'error'; readonly message: string };

// Debounce interval for option changes. 300ms is long enough that
// rapidly cycling presets doesn't queue 5 traces, and short enough
// that a normal click feels instant.
const DEBOUNCE_MS = 300;

export function useTracePreview(file: File | null, options: TraceOptions): TracePreviewState {
  const [state, setState] = useState<TracePreviewState>({ kind: 'idle' });
  const decodedRef = useRef<RawImageData | null>(null);
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
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (file === null) {
      decodedRef.current = null;
      setState({ kind: 'idle' });
      return undefined;
    }
    tokenRef.current += 1;
    const myToken = tokenRef.current;
    decodedRef.current = null;
    setState({ kind: 'decoding' });
    loadImageAsRawData(file, PREVIEW_MAX_EDGE_PX)
      .then((img) => {
        if (tokenRef.current !== myToken) return;
        decodedRef.current = img;
        setState({ kind: 'tracing' });
        // Read options through the ref so the latest preset wins even
        // if the user changed it between picking the file and decode
        // completing (R-H1 fix).
        runTrace(img, optionsRef.current, setState);
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== myToken) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      tokenRef.current += 1;
    };
    // Note: deliberately uses `options` from closure without listing
    // it as a dep — a preset switch is handled by the separate
    // effect below so a file with the same identity doesn't trigger
    // a full re-decode each time the user nudges a knob.
  }, [file]);

  useEffect(() => {
    const img = decodedRef.current;
    if (img === null) return undefined;
    tokenRef.current += 1;
    const myToken = tokenRef.current;
    setState({ kind: 'tracing' });
    const timer = window.setTimeout(() => {
      if (tokenRef.current !== myToken) return;
      runTrace(img, options, setState);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [options]);

  return state;
}

function runTrace(
  img: RawImageData,
  options: TraceOptions,
  setState: (next: TracePreviewState) => void,
): void {
  // Trace is async — runs in the Worker if available, otherwise
  // inline. Either way the work happens off the React-render-path so
  // the "tracing" state can paint first. Output is the same shape the
  // commit flow consumes, then stringified to SVG locally for the
  // browser to render.
  void (async () => {
    try {
      const { paths } = await traceImageWithFallback(img, options);
      const svg = coloredPathsToSvg(paths, img.width, img.height);
      setState({ kind: 'ready', svg, width: img.width, height: img.height });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
