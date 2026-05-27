// useTracePreview — hook that produces a live SVG preview of how a
// raster image will trace under the current options. Used by
// ImportImageDialog so the user can flip between presets and see the
// result instead of guessing-then-committing.
//
// Phases (all guarded by the latest-call-wins token so a slow trace
// followed by a fast trace can't show stale output):
//   1. file changes → decode at the preview-size cap once
//   2. options change → re-run traceImageToSvgString on the decoded
//      pixels, debounced 300ms so dragging a slider doesn't thrash
//   3. SVG goes through sanitizeSvg before reaching the renderer —
//      defense-in-depth even though imagetracerjs's output is trusted

import { useEffect, useRef, useState } from 'react';
import {
  type RawImageData,
  type TraceOptions,
  traceImageToSvgString,
} from '../../core/trace';
import { sanitizeSvg } from '../../io/svg/sanitize';
import { loadImageAsRawData, PREVIEW_MAX_EDGE_PX } from './image-loader';

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

export function useTracePreview(
  file: File | null,
  options: TraceOptions,
): TracePreviewState {
  const [state, setState] = useState<TracePreviewState>({ kind: 'idle' });
  const decodedRef = useRef<RawImageData | null>(null);
  // Monotonic token. Each effect run captures its token; on completion
  // it bails if the latest token has advanced — stops slow traces
  // from clobbering a newer "ready" result.
  const tokenRef = useRef(0);

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
        runTrace(img, options, setState);
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
  // Trace is sync but can run for 50-200ms on a 400px image. Defer
  // to a microtask so React can paint the "tracing" state first; the
  // setTimeout in the options-effect already amortizes the rapid-
  // change case, this is just the first-paint courtesy.
  queueMicrotask(() => {
    try {
      const raw = traceImageToSvgString(img, options);
      const { clean } = sanitizeSvg(raw);
      const responsive = makeSvgResponsive(clean, img.width, img.height);
      setState({ kind: 'ready', svg: responsive, width: img.width, height: img.height });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// imagetracerjs emits <svg width="W" height="H">…</svg> with no
// viewBox (we set viewbox:false in trace-image so coordinates stay
// in pixel space). For the preview we want the SVG to scale to its
// container instead. Replace the opening tag's attrs with a viewBox
// + 100% sizing so it letterboxes into the preview frame.
function makeSvgResponsive(svg: string, width: number, height: number): string {
  const opener = svg.match(/^<svg\b[^>]*>/i);
  if (opener === null) return svg;
  const replacement = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
  return svg.replace(opener[0], replacement);
}
