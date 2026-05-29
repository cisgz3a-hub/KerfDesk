// ImportImageDialog — Phase E modal for picking a raster image,
// adjusting trace parameters, and committing the traced object to
// the scene.
//
// Flow:
//   1. User picks a PNG/JPG via <input type="file">
//   2. Image is decoded into RawImageData (image-loader.ts)
//   3. User picks a preset + tweaks brightness/contrast/gamma/invert
//      + dither (AdjustmentControls) — live preview via
//      useTracePreview while they tune.
//   4. Submit → traceImage (Web Worker if available, inline fallback)
//      → ColoredPath[] directly from imagetracerjs tracedata
//      (bypassing parseSvg's curve-flattening) → insert the vector
//      trace AND its source bitmap as one undoable pair via
//      importTracedWithSource (ADR-026): both share one fit-to-bed
//      transform so they overlay, the trace draws on top and is the
//      selection, the source lands on its image-mode layer ready to
//      burn or delete.
//
// Result is tagged with `kind: 'traced-image'` so the source
// filename + future "re-trace from original raster" workflow can
// find it.
//
// Presentational pieces (FilePicker, PresetPicker, DialogActions,
// styles) live in dialog-parts.tsx; the pure-data option transforms
// (mergeAdjustments, hasAggressivePreprocessing,
// relaxAggressivePreprocessing) live in trace-options.ts. This file
// only owns state + the commit flow + the dialog shell.

import { useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { DEFAULT_TRACE_OPTIONS, TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import {
  AdjustmentControls,
  DEFAULT_ADJUSTMENTS,
  type AdjustmentValues,
} from './AdjustmentControls';
import {
  DialogActions,
  FilePicker,
  PresetHint,
  PresetPicker,
  backdropStyle,
  headingStyle,
  panelStyle,
} from './dialog-parts';
import { extractLumaBase64, loadImageAsRawData, readFileAsDataUrl } from './image-loader';
import { mergeAdjustments } from './trace-options';
import { traceImageWithFallback } from './use-trace-worker-client';
import { TracePreview } from './TracePreview';
import { useTracePreview } from './use-trace-preview';

export function ImportImageDialog(): JSX.Element | null {
  const open = useUiStore((s) => s.imageDialogOpen);
  if (!open) return null;
  return <DialogBody />;
}

function DialogBody(): JSX.Element {
  const close = useUiStore((s) => s.closeImageDialog);
  const importTracedWithSource = useStore((s) => s.importTracedWithSource);
  const pushToast = useToastStore((s) => s.pushToast);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<string>('Line Art');
  const [adjustments, setAdjustments] = useState<AdjustmentValues>(DEFAULT_ADJUSTMENTS);
  const [busy, setBusy] = useState(false);
  // Layer the user adjustments on top of the preset. The preset
  // already pins the trace-side knobs (numberOfColors, lineFilter,
  // etc.); we just merge the LF1 image-level levers in.
  //
  // useMemo is load-bearing — useTracePreview depends on `options` as
  // a useEffect dep, so a fresh object reference every render would
  // re-fire the effect on every render, repeatedly cancelling the
  // 300ms debounce timer and leaving the preview stuck in 'tracing'.
  // (Audit finding H1, 2026-05-28.) Memoise on the SCALAR contents,
  // not on `presetOptions` itself, because `presetOptions` is
  // re-derived from `TRACE_PRESETS[preset]` each render and would
  // otherwise be ref-unstable too.
  const options: TraceOptions = useMemo(
    () => mergeAdjustments(TRACE_PRESETS[preset] ?? DEFAULT_TRACE_OPTIONS, adjustments),
    [preset, adjustments],
  );
  const preview = useTracePreview(file, options);
  const dialogRef = useRef<HTMLDivElement>(null);
  // R-M1 a11y: Escape closes, Tab cycles within, focus returns to the
  // toolbar button on close.
  useDialogA11y(dialogRef, close);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (file === null) {
      pushToast('Pick an image file first.', 'warning');
      return;
    }
    void commit({ file, options }, { importTracedWithSource, pushToast, close, setBusy });
  };

  return (
    <div
      ref={dialogRef}
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Import raster image"
      tabIndex={-1}
    >
      <form onSubmit={onSubmit} style={panelStyle}>
        <h2 style={headingStyle}>Trace Image</h2>
        <FilePicker file={file} onPick={setFile} />
        <PresetPicker value={preset} onChange={setPreset} />
        <AdjustmentControls values={adjustments} onChange={setAdjustments} />
        <TracePreview state={preview} />
        <PresetHint />
        <DialogActions canSubmit={file !== null && !busy} busy={busy} onCancel={close} />
      </form>
    </div>
  );
}

async function commit(
  args: { readonly file: File; readonly options: TraceOptions },
  ctx: {
    readonly importTracedWithSource: ReturnType<typeof useStore.getState>['importTracedWithSource'];
    readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
    readonly close: () => void;
    readonly setBusy: (v: boolean) => void;
  },
): Promise<void> {
  ctx.setBusy(true);
  try {
    const image = await loadImageAsRawData(args.file);
    // LF1-port path: tracedata → ColoredPath[] directly, skipping the
    // SVG-string + parseSvg detour that flattened Béziers at coarse
    // tolerance. Curves stay at imagetracerjs's analytic fidelity
    // through to compile. Runs in a Web Worker when one is available,
    // falling back to inline tracing otherwise (see
    // use-trace-worker-client.ts). traceImageWithFallback wraps the
    // raw call with the H3 retry semantics — on zero paths with an
    // aggressive preset, it retries with the levers relaxed — so the
    // preview and commit paths produce the same result.
    const { paths, bounds } = await traceImageWithFallback(image, args.options);
    if (paths.length === 0) {
      ctx.pushToast(
        `Tracing ${args.file.name} produced no paths — try a higher contrast image.`,
        'warning',
      );
      return;
    }
    const traced: TracedImage = {
      kind: 'traced-image',
      id: crypto.randomUUID(),
      source: args.file.name,
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
    };
    // ADR-026: keep the source bitmap on the canvas with the trace. Its
    // bounds are the FULL image frame in the same pixel space the trace
    // bounds live in, so the single shared fit-to-bed transform that
    // importTracedWithSource applies overlays the two pixel-for-pixel.
    // dataUrl holds the original full-res bytes; pixelWidth/Height + luma
    // come from the decoded image so the burnable dither path stays
    // self-consistent (mirrors Toolbar's Engrave Image flow).
    const source: RasterImage = {
      kind: 'raster-image',
      id: crypto.randomUUID(),
      source: args.file.name,
      dataUrl: await readFileAsDataUrl(args.file),
      pixelWidth: image.width,
      pixelHeight: image.height,
      bounds: { minX: 0, minY: 0, maxX: image.width, maxY: image.height },
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      lumaBase64: extractLumaBase64(image),
    };
    ctx.importTracedWithSource(traced, source);
    const colorCount = traced.paths.length;
    ctx.pushToast(
      `Traced ${args.file.name} — ${colorCount} color${colorCount === 1 ? '' : 's'}, source kept`,
      'success',
    );
    ctx.close();
  } catch (err) {
    ctx.pushToast(
      `Could not trace ${args.file.name}: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    ctx.setBusy(false);
  }
}
