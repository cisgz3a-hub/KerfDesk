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
//   3. User picks a preset + tunes Trace settings, with live preview
//      via useTracePreview while they tune.
//   4. Submit → traceImage (Web Worker if available, inline fallback)
//      → ColoredPath[] directly from imagetracerjs tracedata
//      (bypassing parseSvg's curve-flattening) → overlay the vector
//      trace onto the existing bitmap via traceExistingImage
//      (ADR-026): the trace takes the source's transform so they
//      register pixel-for-pixel, draws on top, becomes the selection,
//      and the source is re-tagged 'trace-source' as the deletable
//      backing.
//
// Result is tagged with `kind: 'traced-image'` plus the source raster id so
// "Re-trace Original" can reopen this dialog from the kept backing image.
//
// Presentational pieces (SourceLabel, PresetPicker, DialogActions,
// styles) live in dialog-parts.tsx; the pure-data option transforms
// (hasAggressivePreprocessing, relaxAggressivePreprocessing) live in
// trace-options.ts. This file
// only owns state + the commit flow + the dialog shell.

import { useEffect, useMemo, useState } from 'react';
import {
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  type TraceBoundary,
  type TraceOptions,
} from '../../core/trace';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { Dialog } from '../kit';
import {
  DialogActions,
  DeleteImageAfterTraceToggle,
  PresetHint,
  PresetPicker,
  PresetWarning,
  SourceLabel,
  TraceFillStylePicker,
  type TraceFillStyle,
} from './dialog-parts';
import { dataUrlToFile, loadImageAsRawData } from './image-loader';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { TraceSettingsControls } from './TraceSettingsControls';
import { traceImageRegion } from './trace-region';
import { TracePreview } from './TracePreview';
import { useTracePreview } from './use-trace-preview';

export function ImportImageDialog(): JSX.Element | null {
  const dialog = useUiStore((s) => s.imageDialog);
  if (dialog === null) return null;
  return dialog.replaceTraceId === undefined ? (
    <DialogBody seed={dialog.source} />
  ) : (
    <DialogBody seed={dialog.source} replaceTraceId={dialog.replaceTraceId} />
  );
}

function DialogBody(props: {
  readonly seed: RasterImage;
  readonly replaceTraceId?: string;
}): JSX.Element {
  const { seed } = props;
  const close = useUiStore((s) => s.closeImageDialog);
  const traceExistingImage = useStore((s) => s.traceExistingImage);
  const pushToast = useToastStore((s) => s.pushToast);
  const file = useTraceSourceFile(seed, pushToast);
  const [preset, setPreset] = useState<string>('Line Art');
  const [traceSettings, setTraceSettings] = useState<LightBurnTraceSettingOverrides>({});
  const [traceFillStyle, setTraceFillStyle] = useState<TraceFillStyle>('scanline');
  const [deleteSourceAfterTrace, setDeleteSourceAfterTrace] = useState(false);
  const [boundary, setBoundary] = useState<TraceBoundary | null>(null);
  const [busy, setBusy] = useState(false);
  // Layer the LightBurn-style trace settings on top of the preset.
  // Image-level edits stay in Adjust Image, so Trace Image keeps one
  // authoritative vector workflow: cutoff, threshold, ignore,
  // smoothness, and optimize.
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
    () => mergeLightBurnTraceSettings(presetOptions, traceSettings),
    [presetOptions, traceSettings],
  );
  const supportsTraceFillStyle = isFilledContourTraceOptions(options);
  const preview = useTracePreview(file, options, boundary);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (file === null) {
      pushToast('Image still loading — try again in a moment.', 'warning');
      return;
    }
    const traceArgs = {
      file,
      options,
      seed,
      traceFillStyle: supportsTraceFillStyle ? traceFillStyle : 'scanline',
      deleteSourceAfterTrace,
      boundary,
      ...(props.replaceTraceId === undefined ? {} : { replaceTraceId: props.replaceTraceId }),
    };
    void commit(traceArgs, {
      traceExistingImage,
      pushToast,
      close,
      setBusy,
      getCurrentObject: (id) => useStore.getState().project.scene.objects.find((o) => o.id === id),
    });
  };

  // kit Dialog owns the a11y wiring (Escape, focus trap, focus return).
  return (
    <Dialog onClose={close} ariaLabel="Trace image" as="form" onSubmit={onSubmit} size="md">
      <h2 className="lf-dialog-title">Trace Image</h2>
      <SourceLabel name={seed.source} />
      <PresetPicker value={preset} onChange={setPreset} />
      <PresetWarning preset={preset} onPresetChange={setPreset} />
      {supportsTraceFillStyle ? (
        <TraceFillStylePicker value={traceFillStyle} onChange={setTraceFillStyle} />
      ) : null}
      <TraceSettingsControls
        preset={presetOptions}
        overrides={traceSettings}
        sourceHasTransparency={traceSourceHasTransparency(preview)}
        onChange={setTraceSettings}
      />
      <TracePreviewPanel
        preview={preview}
        seed={seed}
        boundary={boundary}
        setBoundary={setBoundary}
      />
      <DeleteImageAfterTraceToggle
        checked={deleteSourceAfterTrace}
        onChange={setDeleteSourceAfterTrace}
      />
      <PresetHint />
      <DialogActions canSubmit={file !== null && !busy} busy={busy} onCancel={close} />
    </Dialog>
  );
}

function isFilledContourTraceOptions(options: TraceOptions): boolean {
  return options.traceMode !== 'centerline' && options.traceMode !== 'edge';
}

function traceSourceHasTransparency(
  preview: ReturnType<typeof useTracePreview>,
): boolean | undefined {
  return preview.kind === 'tracing' || preview.kind === 'ready'
    ? preview.sourceHasTransparency
    : undefined;
}

function useTraceSourceFile(
  seed: RasterImage,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): File | null {
  const [file, setFile] = useState<File | null>(null);
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
  return file;
}

function TracePreviewPanel(props: {
  readonly preview: ReturnType<typeof useTracePreview>;
  readonly seed: RasterImage;
  readonly boundary: TraceBoundary | null;
  readonly setBoundary: (boundary: TraceBoundary | null) => void;
}): JSX.Element {
  return (
    <TracePreview
      state={props.preview}
      sourceDataUrl={props.seed.dataUrl}
      imageSize={{ width: props.seed.pixelWidth, height: props.seed.pixelHeight }}
      boundary={props.boundary}
      onBoundaryChange={props.setBoundary}
      onBoundaryClear={() => props.setBoundary(null)}
    />
  );
}

// Exported for testing the source-revalidation guard (P2-A).
export async function commit(
  args: {
    readonly file: File;
    readonly options: TraceOptions;
    readonly seed: RasterImage;
    readonly traceFillStyle?: TraceFillStyle;
    readonly deleteSourceAfterTrace?: boolean;
    readonly replaceTraceId?: string;
    readonly boundary?: TraceBoundary | null;
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
    // use-trace-worker-client.ts). traceImageRegion applies any
    // LightBurn-style Boundary crop, traces that crop through the shared
    // fallback path, then offsets geometry back into the source-image
    // coordinate system. That keeps preview, commit, and overlay
    // registration on the same pixels.
    const { paths, bounds } = await traceImageRegion(image, args.options, args.boundary ?? null);
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
    const traceMode = traceModeForOptions(args.options);
    const operationOverride = operationOverrideForTrace(traceMode, args.traceFillStyle);
    const traced: TracedImage = {
      kind: 'traced-image',
      id: args.replaceTraceId ?? crypto.randomUUID(),
      source: args.seed.source,
      traceSourceId: args.seed.id,
      traceMode,
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
      ...(operationOverride === undefined ? {} : { operationOverride }),
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
    const deleteSourceAfterTrace = args.deleteSourceAfterTrace === true;
    const traceOptions = {
      deleteSourceAfterTrace,
      ...(args.replaceTraceId === undefined ? {} : { replaceTraceId: args.replaceTraceId }),
    };
    ctx.traceExistingImage(args.seed.id, traced, traceOptions);
    const colorCount = traced.paths.length;
    const sourceStatus = deleteSourceAfterTrace ? 'source deleted' : 'source kept';
    ctx.pushToast(
      `Traced ${args.seed.source} — ${colorCount} color${colorCount === 1 ? '' : 's'}, ${sourceStatus}`,
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

function operationOverrideForTrace(
  traceMode: TracedImage['traceMode'],
  fillStyle: TraceFillStyle | undefined,
): TracedImage['operationOverride'] {
  if (traceMode !== 'filled-contours') return undefined;
  if (fillStyle === undefined) return undefined;
  return { mode: 'fill', fillStyle };
}

function traceModeForOptions(options: TraceOptions): NonNullable<TracedImage['traceMode']> {
  if (options.traceMode === 'centerline') return 'centerline';
  if (options.traceMode === 'edge') return 'edge';
  return 'filled-contours';
}
