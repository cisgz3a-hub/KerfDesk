// Trace runs on the selected RasterImage (ADR-027), preserving the existing
// File-keyed preview and worker trace pipeline. Laser projects default to
// editable vector output (LightBurn's Trace model, ADR-238); materializing the
// trace through the Raster/Image pipeline (ADR-235) remains selectable, and
// CNC stays vector-only. Both outputs retain source provenance for Re-trace
// Original. Pure UI pieces live in dialog-parts.tsx.

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
  SourceLabel,
  TraceOutputFields,
  type TraceFillStyle,
  type TraceOutput,
} from './dialog-parts';
import { dataUrlToFile } from './image-loader';
import type { PreparedTrace } from './prepared-trace';
import { mergeLightBurnTraceSettings, type LightBurnTraceSettingOverrides } from './trace-options';
import { TraceSettingsControls } from './TraceSettingsControls';
import type { BoundaryMode } from './region-enhance-trace';
import { BoundaryModePicker } from './BoundaryModePicker';
import { useBoundarySelection } from './use-boundary-selection';
import { TracePreview } from './TracePreview';
import { resolveTraceCommitResult } from './trace-commit-result';
import { commitTraceOutput } from './trace-output-commit';
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

type TraceCommitArgs = {
  readonly file: File;
  readonly options: TraceOptions;
  readonly seed: RasterImage;
  readonly traceOutput?: TraceOutput;
  readonly traceFillStyle?: TraceFillStyle;
  readonly deleteSourceAfterTrace?: boolean;
  readonly replaceTraceId?: string;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
};

type TraceCommitContext = {
  readonly traceExistingImage: ReturnType<typeof useStore.getState>['traceExistingImage'];
  readonly commitRasterizedTrace: ReturnType<typeof useStore.getState>['commitRasterizedTrace'];
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
  readonly close: () => void;
  readonly setBusy: (v: boolean) => void;
  readonly getCurrentProject: () => ReturnType<typeof useStore.getState>['project'];
};

function DialogBody(props: {
  readonly seed: RasterImage;
  readonly replaceTraceId?: string;
}): JSX.Element {
  const { seed } = props;
  const close = useUiStore((s) => s.closeImageDialog);
  const traceExistingImage = useStore((s) => s.traceExistingImage);
  const commitRasterizedTrace = useStore((s) => s.commitRasterizedTrace);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const pushToast = useToastStore((s) => s.pushToast);
  const file = useTraceSourceFile(seed, pushToast);
  const [preset, setPreset] = useState<string>('Line Art');
  const [traceSettings, setTraceSettings] = useState<LightBurnTraceSettingOverrides>({});
  const [traceFillStyle, setTraceFillStyle] = useState<TraceFillStyle>('scanline');
  const [traceOutput, setTraceOutput] = useState<TraceOutput>('vector');
  const [deleteSourceAfterTrace, setDeleteSourceAfterTrace] = useState(false);
  const boundarySelection = useBoundarySelection();
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
  const effectiveTraceOutput: TraceOutput = machineKind === 'cnc' ? 'vector' : traceOutput;
  const preview = useSelectedTracePreview(file, options, boundarySelection, seed);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    submitTraceDialog({
      file,
      options,
      seed,
      traceOutput: effectiveTraceOutput,
      traceFillStyle:
        effectiveTraceOutput === 'vector' && supportsTraceFillStyle ? traceFillStyle : 'scanline',
      deleteSourceAfterTrace,
      boundary: boundarySelection.boundary,
      boundaryMode: boundarySelection.boundaryMode,
      preview,
      replaceTraceId: props.replaceTraceId,
      traceExistingImage,
      commitRasterizedTrace,
      pushToast,
      close,
      setBusy,
    });
  };

  // kit Dialog owns the a11y wiring (Escape, focus trap, focus return).
  return (
    <Dialog onClose={close} ariaLabel="Trace image" as="form" onSubmit={onSubmit} size="md">
      <h2 className="lf-dialog-title">Trace Image</h2>
      <SourceLabel name={seed.source} />
      <TraceOutputFields
        machineKind={machineKind}
        traceOutput={traceOutput}
        onTraceOutputChange={setTraceOutput}
        supportsFillStyle={supportsTraceFillStyle}
        traceFillStyle={traceFillStyle}
        onTraceFillStyleChange={setTraceFillStyle}
      />
      <PresetPicker value={preset} onChange={setPreset} />
      <TraceSettingsControls
        preset={presetOptions}
        overrides={traceSettings}
        sourceHasTransparency={traceSourceHasTransparency(preview)}
        onChange={setTraceSettings}
      />
      <TracePreviewPanel preview={preview} seed={seed} boundarySelection={boundarySelection} />
      <DeleteImageAfterTraceToggle
        checked={deleteSourceAfterTrace}
        onChange={setDeleteSourceAfterTrace}
      />
      <PresetHint />
      <DialogActions canSubmit={file !== null && !busy} busy={busy} onCancel={close} />
    </Dialog>
  );
}

function preparedTraceEntry(preview: ReturnType<typeof useTracePreview>): {
  readonly preparedTrace?: PreparedTrace;
} {
  return preview.kind === 'ready' && preview.preparedTrace !== undefined
    ? { preparedTrace: preview.preparedTrace }
    : {};
}

function useSelectedTracePreview(
  file: File | null,
  options: TraceOptions,
  selection: ReturnType<typeof useBoundarySelection>,
  seed: RasterImage,
): ReturnType<typeof useTracePreview> {
  return useTracePreview(file, options, selection.boundary, selection.boundaryMode, {
    width: seed.pixelWidth,
    height: seed.pixelHeight,
  });
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
  readonly boundarySelection: ReturnType<typeof useBoundarySelection>;
}): JSX.Element {
  const selection = props.boundarySelection;
  return (
    <>
      <TracePreview
        state={props.preview}
        sourceDataUrl={props.seed.dataUrl}
        imageSize={{ width: props.seed.pixelWidth, height: props.seed.pixelHeight }}
        boundary={selection.boundary}
        onBoundaryChange={selection.setBoundary}
        onBoundaryClear={selection.clearBoundary}
      />
      {selection.boundary !== null ? (
        <BoundaryModePicker value={selection.boundaryMode} onChange={selection.setBoundaryMode} />
      ) : null}
    </>
  );
}

// Assemble the trace args from the dialog's live state and hand them to commit.
// Extracted from DialogBody so that render function stays inside the 80-line
// function cap (ADR-015) after the CNC-hint conditional was added.
function submitTraceDialog(deps: {
  readonly file: File | null;
  readonly options: TraceOptions;
  readonly seed: RasterImage;
  readonly traceOutput: TraceOutput;
  readonly traceFillStyle: TraceFillStyle;
  readonly deleteSourceAfterTrace: boolean;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
  readonly preview: ReturnType<typeof useTracePreview>;
  readonly replaceTraceId: string | undefined;
  readonly traceExistingImage: ReturnType<typeof useStore.getState>['traceExistingImage'];
  readonly commitRasterizedTrace: ReturnType<typeof useStore.getState>['commitRasterizedTrace'];
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
  readonly close: () => void;
  readonly setBusy: (v: boolean) => void;
}): void {
  if (deps.file === null) {
    deps.pushToast('Image still loading — try again in a moment.', 'warning');
    return;
  }
  const traceArgs = {
    file: deps.file,
    options: deps.options,
    seed: deps.seed,
    traceOutput: deps.traceOutput,
    traceFillStyle: deps.traceFillStyle,
    deleteSourceAfterTrace: deps.deleteSourceAfterTrace,
    boundary: deps.boundary,
    boundaryMode: deps.boundaryMode,
    ...preparedTraceEntry(deps.preview),
    ...(deps.replaceTraceId === undefined ? {} : { replaceTraceId: deps.replaceTraceId }),
  };
  void commit(traceArgs, {
    traceExistingImage: deps.traceExistingImage,
    commitRasterizedTrace: deps.commitRasterizedTrace,
    pushToast: deps.pushToast,
    close: deps.close,
    setBusy: deps.setBusy,
    getCurrentProject: () => useStore.getState().project,
  });
}

// Exported for testing the source-revalidation guard (P2-A).
export async function commit(args: TraceCommitArgs, ctx: TraceCommitContext): Promise<void> {
  ctx.setBusy(true);
  try {
    // Direct tracedata path: ColoredPath[] directly, skipping the
    // SVG-string + parseSvg detour that flattened Béziers at coarse
    // tolerance. Curves stay at imagetracerjs's analytic fidelity
    // through to compile. Runs in a Web Worker when one is available,
    // falling back to inline tracing otherwise (see
    // use-trace-worker-client.ts). traceImageWithBoundaryMode applies the
    // dialog's boundary box in the selected mode: 'crop' traces just the
    // region and offsets it back (LightBurn Boundary crop); 'enhance'
    // re-traces the region supersampled and patches it into the full trace
    // (ADR-113). Either way geometry returns in source-image coordinates so
    // preview, commit, and overlay registration stay on the same pixels.
    const { paths, bounds, width, height } = await resolveTraceCommitResult({
      ...args,
      sourceGrid: { width: args.seed.pixelWidth, height: args.seed.pixelHeight },
    });
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
      tracePixelWidth: width,
      tracePixelHeight: height,
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
      ...(operationOverride === undefined ? {} : { operationOverride }),
    };
    const liveProject = ctx.getCurrentProject();
    const liveSource = liveProject.scene.objects.find((object) => object.id === args.seed.id);
    // P2-A: refuse to commit if the live source changed (content/grid) or was
    // removed while the modal was open. Vector output may follow a moved source;
    // raster output captures the complete live object and operation references
    // below, then checks them again after its asynchronous bitmap build.
    if (!sameTraceSource(liveSource, args.seed)) {
      ctx.pushToast(
        `The source image for ${args.seed.source} changed or was removed — re-open Trace to continue.`,
        'error',
      );
      return;
    }
    if (await commitTraceOutput(args, ctx, traced, liveProject)) ctx.close();
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
