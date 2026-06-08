// ImportImageDialog — the Trace tool's modal. Trace runs on a bitmap
// the operator ALREADY imported and selected (LightBurn's model,
// ADR-027); the dialog is seeded with that RasterImage, never a blank
// file picker.
//
// Flow:
//   1. Toolbar's "Trace…" (enabled only with a raster-image selected)
//      seeds ui-store.imageDialog with the chosen RasterImage.
//   2. Its embedded dataUrl is round-tripped back into a File
//      (dataUrlToFile) so the existing File-keyed preview + trace
//      pipeline (useTracePreview, loadImageAsRawData) runs unchanged.
//   3. User picks a preset + tunes Trace settings plus the temporary
//      pre-threshold adjustment controls — live preview via
//      useTracePreview while they tune.
//   4. Submit → traceImage (Web Worker if available, inline fallback)
//      → ColoredPath[] directly from imagetracerjs tracedata
//      (bypassing parseSvg's curve-flattening) → overlay the vector
//      trace onto the existing bitmap via traceExistingImage
//      (ADR-026): the trace takes the source's transform so they
//      register pixel-for-pixel, draws on top, becomes the selection,
//      and the source is re-tagged 'trace-source' as the deletable
//      backing.
//
// Result is tagged with `kind: 'traced-image'` so the source
// filename + future "re-trace from original raster" workflow can
// find it.
//
// Presentational pieces (SourceLabel, PresetPicker, DialogActions,
// styles) live in dialog-parts.tsx; the pure-data option transforms
// (mergeAdjustments, hasAggressivePreprocessing,
// relaxAggressivePreprocessing) live in trace-options.ts. This file
// only owns state + the commit flow + the dialog shell.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
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
  PresetHint,
  PresetPicker,
  SourceLabel,
  backdropStyle,
  headingStyle,
  panelStyle,
} from './dialog-parts';
import { dataUrlToFile, loadImageAsRawData } from './image-loader';
import {
  mergeAdjustments,
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from './trace-options';
import { TraceSettingsControls } from './TraceSettingsControls';
import { traceImageWithFallback } from './use-trace-worker-client';
import { TracePreview } from './TracePreview';
import { useTracePreview } from './use-trace-preview';

export function ImportImageDialog(): JSX.Element | null {
  const seed = useUiStore((s) => s.imageDialog);
  if (seed === null) return null;
  return <DialogBody seed={seed} />;
}

function DialogBody({ seed }: { readonly seed: RasterImage }): JSX.Element {
  const close = useUiStore((s) => s.closeImageDialog);
  const traceExistingImage = useStore((s) => s.traceExistingImage);
  const pushToast = useToastStore((s) => s.pushToast);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<string>('Line Art');
  const [traceSettings, setTraceSettings] = useState<LightBurnTraceSettingOverrides>({});
  const [adjustments, setAdjustments] = useState<AdjustmentValues>(DEFAULT_ADJUSTMENTS);
  const [busy, setBusy] = useState(false);
  // Reconstruct a File from the seed bitmap's embedded dataUrl so the
  // File-keyed preview + trace pipeline runs unchanged (image-loader.
  // dataUrlToFile). The `cancelled` guard drops a stale decode if the
  // seed swaps or the dialog unmounts before fetch resolves.
  useEffect(() => {
    let cancelled = false;
    dataUrlToFile(seed.dataUrl, seed.source)
      .then((f) => {
        if (!cancelled) setFile(f);
      })
      .catch(() => {
        if (!cancelled) pushToast(`Could not read ${seed.source} for tracing.`, 'error');
      });
    return (): void => {
      cancelled = true;
    };
  }, [seed.dataUrl, seed.source, pushToast]);
  // Layer the user adjustments on top of the preset. The preset
  // already pins the trace-side knobs (numberOfColors, lineFilter,
  // etc.); we just merge the LF1-compatible image-level levers in.
  //
  // useMemo is load-bearing — useTracePreview depends on `options` as
  // a useEffect dep, so a fresh object reference every render would
  // re-fire the effect on every render, repeatedly cancelling the
  // 300ms debounce timer and leaving the preview stuck in 'tracing'.
  // (Audit finding H1, 2026-05-28.) Memoise on the SCALAR contents,
  // not on `presetOptions` itself, because `presetOptions` is
  // re-derived from `TRACE_PRESETS[preset]` each render and would
  // otherwise be ref-unstable too.
  const presetOptions = TRACE_PRESETS[preset] ?? DEFAULT_TRACE_OPTIONS;
  const options: TraceOptions = useMemo(
    () => mergeAdjustments(mergeLightBurnTraceSettings(presetOptions, traceSettings), adjustments),
    [presetOptions, traceSettings, adjustments],
  );
  const preview = useTracePreview(file, options);
  const dialogRef = useRef<HTMLDivElement>(null);
  // R-M1 a11y: Escape closes, Tab cycles within, focus returns to the
  // toolbar button on close.
  useDialogA11y(dialogRef, close);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (file === null) {
      pushToast('Image still loading — try again in a moment.', 'warning');
      return;
    }
    void commit(
      { file, options, seed },
      {
        traceExistingImage,
        pushToast,
        close,
        setBusy,
        getCurrentObject: (id) =>
          useStore.getState().project.scene.objects.find((o) => o.id === id),
      },
    );
  };

  return (
    <div
      ref={dialogRef}
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Trace image"
      tabIndex={-1}
    >
      <form onSubmit={onSubmit} style={panelStyle}>
        <h2 style={headingStyle}>Trace Image</h2>
        <SourceLabel name={seed.source} />
        <PresetPicker value={preset} onChange={setPreset} />
        <TraceSettingsControls
          preset={presetOptions}
          overrides={traceSettings}
          onChange={setTraceSettings}
        />
        <AdjustmentControls values={adjustments} onChange={setAdjustments} />
        <TracePreview state={preview} />
        <PresetHint />
        <DialogActions canSubmit={file !== null && !busy} busy={busy} onCancel={close} />
      </form>
    </div>
  );
}

// Exported for testing the source-revalidation guard (P2-A).
export async function commit(
  args: {
    readonly file: File;
    readonly options: TraceOptions;
    readonly seed: RasterImage;
  },
  ctx: {
    readonly traceExistingImage: ReturnType<typeof useStore.getState>['traceExistingImage'];
    readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
    readonly close: () => void;
    readonly setBusy: (v: boolean) => void;
    readonly getCurrentObject: (id: string) => SceneObject | undefined;
  },
): Promise<void> {
  ctx.setBusy(true);
  try {
    const image = await loadImageAsRawData(args.file);
    // Direct tracedata path: ColoredPath[] directly, skipping the
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
        `Tracing ${args.seed.source} produced no paths — try a higher contrast image.`,
        'warning',
      );
      return;
    }
    // transform is a placeholder: applyTraceToExisting overwrites it
    // with the source bitmap's own transform so the vectors register
    // pixel-for-pixel over the features they came from (ADR-026).
    const traced: TracedImage = {
      kind: 'traced-image',
      id: crypto.randomUUID(),
      source: args.seed.source,
      traceMode: args.options.traceMode === 'centerline' ? 'centerline' : 'filled-contours',
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
    };
    // P2-A: refuse to commit if the live source changed (content/grid) or was
    // removed while the modal was open — overlaying then would misregister the
    // trace. A transform-only move is fine (applyTraceToExisting registers to
    // the live source's transform).
    if (!sameTraceSource(ctx.getCurrentObject(args.seed.id), args.seed)) {
      ctx.pushToast(
        `The source image for ${args.seed.source} changed or was removed — re-open Trace to continue.`,
        'error',
      );
      return;
    }
    ctx.traceExistingImage(args.seed.id, traced);
    const colorCount = traced.paths.length;
    ctx.pushToast(
      `Traced ${args.seed.source} — ${colorCount} color${colorCount === 1 ? '' : 's'}, source kept`,
      'success',
    );
    ctx.close();
  } catch (err) {
    ctx.pushToast(
      `Could not trace ${args.seed.source}: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    ctx.setBusy(false);
  }
}

// True when the live object is still the same raster the trace was computed from
// — same kind, image content (dataUrl), and pixel grid. A transform-only change
// is allowed (the overlay registers to the live transform). Used to refuse a
// commit whose source changed or was removed mid-dialog (P2-A).
export function sameTraceSource(live: SceneObject | undefined, seed: RasterImage): boolean {
  return (
    live !== undefined &&
    live.kind === 'raster-image' &&
    live.dataUrl === seed.dataUrl &&
    live.pixelWidth === seed.pixelWidth &&
    live.pixelHeight === seed.pixelHeight
  );
}
