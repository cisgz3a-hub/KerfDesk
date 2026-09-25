// Trace runs on the selected RasterImage (ADR-027), preserving the existing
// File-keyed preview and worker trace pipeline. Laser projects default to
// editable vector output (LightBurn's Trace model, ADR-238); materializing the
// trace through the Raster/Image pipeline (ADR-235) remains selectable, and
// CNC stays vector-only. Both outputs retain source provenance; Re-trace
// Original needs the source bitmap kept in the scene. Pure UI pieces live in
// dialog-parts.tsx.

import { useRef, useState, type Ref } from 'react';
import { IDENTITY_TRANSFORM, type RasterImage, type TracedImage } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  type TraceBoundary,
  type TraceOptions,
} from '../../core/trace';
import { positionTraceOverRasterSource, useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import type { TraceFillStyle, TraceOutput } from './dialog-parts';
import { rasterDisplayDataUrl } from '../workspace/draw-raster';
import type { PendingPreparedTrace, PreparedTrace } from './prepared-trace';
import { TraceDialogView } from './TraceDialogView';
import type { BoundaryMode } from './region-enhance-trace';
import { BoundaryModePicker } from './BoundaryModePicker';
import type { BoundarySelection } from './use-boundary-selection';
import { TracePreview } from './TracePreview';
import { conditionTracedImageForMachine } from './trace-machine-conditioning';
import { useTraceDialogSettings, useTraceOptions } from './use-trace-dialog-settings';
import { resolveTraceCommitResult } from './trace-commit-result';
import { TraceCommitGridNote, traceCommitGridForClaim } from './trace-commit-grid-note';
import {
  captureTraceCommitOwner,
  claimTraceCommitOwner,
  closeOwnedTraceDialog,
  sameTraceSourceContent,
  type TraceCommitClaim,
} from './trace-commit-ownership';
import { commitTraceOutput } from './trace-output-commit';
import { useTracePreview } from './use-trace-preview';
import { useTraceCommitLifetime } from './use-trace-commit-lifetime';
import {
  preparedTraceEntry,
  type TracePreviewCommitControl,
  type TracePreviewCommitUpdate,
} from './use-trace-preview-settlement';
import { isTraceRequestSuperseded } from './use-trace-worker-client';
import { isTraceAbort, traceAbortError } from './trace-cancellation';
import { useTraceSourceFile } from './use-trace-source-file';

export function ImportImageDialog(): JSX.Element | null {
  const dialog = useUiStore((s) => s.imageDialog);
  if (dialog === null) return null;
  return (
    <DialogBody
      key={dialog.requestToken}
      seed={dialog.source}
      requestToken={dialog.requestToken}
      {...(dialog.replaceTraceId === undefined ? {} : { replaceTraceId: dialog.replaceTraceId })}
      {...(dialog.traceSettings === undefined ? {} : { traceSettings: dialog.traceSettings })}
    />
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
  readonly traceSettings?: TracedImage['traceSettings'];
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
  readonly pendingTrace?: PendingPreparedTrace;
};

type TraceCommitContext = {
  readonly signal?: AbortSignal;
  readonly traceExistingImage: ReturnType<typeof useStore.getState>['traceExistingImage'];
  readonly commitRasterizedTrace: ReturnType<typeof useStore.getState>['commitRasterizedTrace'];
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
  readonly close: () => void;
  readonly setBusy: (v: boolean) => void;
  readonly claimOwner: () => TraceCommitClaim | null;
  readonly settlePreview?: (outcome: TracePreviewCommitUpdate) => void;
};

type DialogBodyProps = {
  readonly seed: RasterImage;
  readonly requestToken: string;
  readonly replaceTraceId?: string;
  readonly traceSettings?: TracedImage['traceSettings'];
};

function DialogBody(props: DialogBodyProps): JSX.Element {
  const { seed } = props;
  const close = useUiStore((s) => s.closeImageDialog);
  const traceExistingImage = useStore((s) => s.traceExistingImage);
  const commitRasterizedTrace = useStore((s) => s.commitRasterizedTrace);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const pushToast = useToastStore((s) => s.pushToast);
  const file = useTraceSourceFile(seed, pushToast);
  // Re-trace Original opens on the settings recorded with the trace (ADR-400).
  const choices = useTraceDialogSettings(machineKind, seed, props);
  const boundarySelection = choices.boundarySelection;
  const [busy, setBusy] = useState(false);
  const captureLifetime = useTraceCommitLifetime(props.requestToken);
  const previewControl = useRef<TracePreviewCommitControl>(null);
  // Layer each style's controls on its preset: detection and contour controls
  // for line artwork, or detail and tone controls for photographic shading.
  //
  // useMemo is load-bearing — useTracePreview depends on `options` as
  // a useEffect dep, so a fresh object reference every render would
  // re-fire the effect on every render, repeatedly cancelling the
  // 300ms debounce timer and leaving the preview stuck in 'tracing'.
  // (Audit finding H1, 2026-05-28.) Memoise on the SCALAR contents,
  // not on `presetOptions` itself, because `presetOptions` is
  // re-derived from `TRACE_PRESETS[preset]` each render and would
  // otherwise be ref-unstable too.
  const presetOptions = TRACE_PRESETS[choices.preset] ?? DEFAULT_TRACE_OPTIONS;
  const options = useTraceOptions(presetOptions, choices.traceSettings);
  const effectiveTraceOutput: TraceOutput = machineKind === 'cnc' ? 'vector' : choices.traceOutput;
  const preview = useSelectedTracePreview(file, options, boundarySelection, seed, previewControl);

  const onSubmit = (): void =>
    submitTraceDialog({
      file,
      options,
      seed,
      traceOutput: effectiveTraceOutput,
      machineKind,
      traceFillStyle: choices.traceFillStyle,
      deleteSourceAfterTrace: choices.deleteSourceAfterTrace,
      boundary: boundarySelection.boundary,
      boundaryMode: boundarySelection.boundaryMode,
      preview,
      replaceTraceId: props.replaceTraceId,
      traceSettings: choices.record(),
      traceExistingImage,
      commitRasterizedTrace,
      pushToast,
      setBusy,
      requestToken: props.requestToken,
      captureLifetime,
      previewControl: previewControl.current,
    });

  // kit Dialog owns the a11y wiring (Escape, focus trap, focus return).
  return (
    <TraceDialogView
      source={seed}
      onClose={close}
      onSubmit={onSubmit}
      presetName={choices.preset}
      onPresetChange={choices.selectPreset}
      settings={{
        preset: presetOptions,
        overrides: choices.traceSettings,
        sourceHasTransparency: traceSourceHasTransparency(preview),
        onChange: choices.setTraceSettings,
      }}
      output={{
        photoShading: options.photoDetail !== undefined,
        machineKind,
        traceOutput: choices.traceOutput,
        onTraceOutputChange: choices.setTraceOutput,
        supportsFillStyle: isFilledContourTraceOptions(options),
        traceFillStyle: choices.traceFillStyle,
        onTraceFillStyleChange: choices.setTraceFillStyle,
      }}
      preview={
        <TracePreviewPanel
          preview={preview}
          seed={seed}
          boundarySelection={boundarySelection}
          photoShading={options.photoDetail !== undefined}
          submission={{ busy, output: effectiveTraceOutput }}
        />
      }
      deleteSource={choices.deleteSourceAfterTrace}
      onDeleteSourceChange={choices.setDeleteSourceAfterTrace}
      canSubmit={file !== null && !busy}
      busy={busy}
    />
  );
}

function useSelectedTracePreview(
  file: File | null,
  options: TraceOptions,
  selection: BoundarySelection,
  seed: RasterImage,
  control: Ref<TracePreviewCommitControl>,
): ReturnType<typeof useTracePreview> {
  return useTracePreview(
    file,
    options,
    selection.boundary,
    selection.boundaryMode,
    { width: seed.pixelWidth, height: seed.pixelHeight },
    control,
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

function TracePreviewPanel(props: {
  readonly submission: { readonly busy: boolean; readonly output: TraceOutput };
  readonly photoShading: boolean;
  readonly preview: ReturnType<typeof useTracePreview>;
  readonly seed: RasterImage;
  readonly boundarySelection: BoundarySelection;
}): JSX.Element {
  const selection = props.boundarySelection;
  return (
    <>
      <TracePreview
        state={props.preview}
        sourceDataUrl={rasterDisplayDataUrl(props.seed)}
        imageSize={{ width: props.seed.pixelWidth, height: props.seed.pixelHeight }}
        boundary={selection.boundary}
        boundaryDisabled={props.submission.busy}
        isRasterizing={
          props.submission.busy &&
          props.submission.output === 'raster' &&
          props.preview.kind === 'ready'
        }
        onBoundaryChange={selection.setBoundary}
        onBoundaryClear={selection.clearBoundary}
      />
      {selection.boundary !== null ? (
        <BoundaryModePicker
          value={selection.boundaryMode}
          onChange={selection.setBoundaryMode}
          allowEnhance={!props.photoShading}
          disabled={props.submission.busy}
        />
      ) : null}
      <TraceCommitGridNote preview={props.preview} source={props.seed} />
    </>
  );
}

// CNC submits no fill style at all, so the committed object carries no fill
// override. fillStyle is read only by the laser compiler (src/core/job), so on
// CNC it was a value the operator could not see — the picker is hidden there —
// and could not act on, yet it still pinned the object to mode:'fill'. That
// would silently hatch-engrave it if the project were later switched to laser.
// Omitting it lets the object follow its layer's mode instead. Laser behaviour
// is unchanged: vector output on a filled-contour preset sends the operator's
// choice, anything else sends the scanline default exactly as before.
function submittedFillStyle(deps: {
  readonly machineKind: 'laser' | 'cnc';
  readonly traceOutput: TraceOutput;
  readonly options: TraceOptions;
  readonly traceFillStyle: TraceFillStyle;
}): { readonly traceFillStyle?: TraceFillStyle } {
  if (deps.machineKind === 'cnc') return {};
  const supportsFillStyle = isFilledContourTraceOptions(deps.options);
  return {
    traceFillStyle:
      deps.traceOutput === 'vector' && supportsFillStyle ? deps.traceFillStyle : 'scanline',
  };
}

// Assemble the trace args from the dialog's live state and hand them to commit.
// Extracted from DialogBody so that render function stays inside the 80-line
// function cap (ADR-015) after the CNC-hint conditional was added.
function submitTraceDialog(deps: {
  readonly file: File | null;
  readonly options: TraceOptions;
  readonly seed: RasterImage;
  readonly traceOutput: TraceOutput;
  readonly machineKind: 'laser' | 'cnc';
  readonly traceFillStyle: TraceFillStyle;
  readonly deleteSourceAfterTrace: boolean;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
  readonly preview: ReturnType<typeof useTracePreview>;
  readonly replaceTraceId: string | undefined;
  readonly traceSettings: NonNullable<TracedImage['traceSettings']>;
  readonly traceExistingImage: ReturnType<typeof useStore.getState>['traceExistingImage'];
  readonly commitRasterizedTrace: ReturnType<typeof useStore.getState>['commitRasterizedTrace'];
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
  readonly setBusy: (v: boolean) => void;
  readonly requestToken: string;
  readonly captureLifetime: ReturnType<typeof useTraceCommitLifetime>;
  readonly previewControl: TracePreviewCommitControl | null;
}): void {
  if (deps.file === null) {
    deps.pushToast('Image still loading — try again in a moment.', 'warning');
    return;
  }
  const owner = captureTraceCommitOwner(deps.seed, deps.requestToken);
  if (owner === null) return;
  const isCurrent = deps.captureLifetime(() => claimTraceCommitOwner(owner) !== null);
  if (isCurrent === null) return;
  if (!isCurrent()) {
    isCurrent.dispose();
    return;
  }
  const pendingTrace = deps.previewControl?.preparation?.();
  const settlePreview = deps.previewControl?.capture();
  const traceArgs = {
    file: deps.file,
    options: deps.options,
    seed: deps.seed,
    traceOutput: deps.traceOutput,
    ...submittedFillStyle(deps),
    deleteSourceAfterTrace: deps.deleteSourceAfterTrace,
    traceSettings: deps.traceSettings,
    boundary: deps.boundary,
    boundaryMode: deps.boundaryMode,
    ...preparedTraceEntry(deps.preview),
    ...(pendingTrace === undefined ? {} : { pendingTrace }),
    ...(deps.replaceTraceId === undefined ? {} : { replaceTraceId: deps.replaceTraceId }),
  };
  void commit(traceArgs, {
    traceExistingImage: deps.traceExistingImage,
    commitRasterizedTrace: deps.commitRasterizedTrace,
    pushToast: deps.pushToast,
    close: () => closeOwnedTraceDialog(owner.dialogRequestToken),
    setBusy: deps.setBusy,
    claimOwner: () => (isCurrent() ? claimTraceCommitOwner(owner) : null),
    signal: isCurrent.signal,
    ...(settlePreview === undefined ? {} : { settlePreview }),
  }).finally(() => {
    if (isCurrent.ownsDialog()) {
      if (isCurrent.signal.aborted) settlePreview?.({ kind: 'error', error: traceAbortError() });
      deps.setBusy(false);
    }
    isCurrent.dispose();
  });
}

// Exported for testing the source-revalidation guard (P2-A).
export async function commit(args: TraceCommitArgs, ctx: TraceCommitContext): Promise<void> {
  if (ctx.claimOwner() === null) return;
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
    const result = await resolveTraceCommitResult({
      ...args,
      sourceGrid: { width: args.seed.pixelWidth, height: args.seed.pixelHeight },
      commitGrid: traceCommitGridForClaim(ctx.claimOwner()),
      signal: ctx.signal,
      progress: (phase) => settleTracePreview(ctx, { kind: 'progress', phase }),
    });
    const owner = ctx.claimOwner();
    if (owner === null) return;
    settleTracePreview(ctx, { kind: 'ready', result });
    const { paths, bounds, width, height, notices } = result;
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
      ...(args.traceSettings === undefined ? {} : { traceSettings: args.traceSettings }),
      ...(operationOverride === undefined ? {} : { operationOverride }),
    };
    const liveProject = owner.project;
    const liveSource = owner.source;
    // P2-A: refuse to commit if the live source changed (content/grid) or was
    // removed while the modal was open. Vector output may follow a moved source;
    // raster output captures the complete live object and operation references
    // below, then checks them again after its asynchronous bitmap build.
    if (!sameTraceSourceContent(liveSource, args.seed)) {
      ctx.pushToast(
        `The source image for ${args.seed.source} changed or was removed — re-open Trace to continue.`,
        'error',
      );
      return;
    }
    // Photo ribbon width encodes tone; generic contour fairing changes that
    // coverage and can erase narrow highlights. Keep its reviewed geometry.
    // Machine conditioning uses the exact live placement that the store will
    // apply. Transform-only source changes are intentionally accepted, so
    // conditioning before this point would use stale physical units.
    const placement = positionTraceOverRasterSource(liveSource, traced).transform;
    const machineKind = liveProject.machine?.kind;
    const commitTraced = conditionTracedImageForMachine(traced, placement, machineKind, args);
    const outputArgs = {
      ...args,
      photoShading: args.options.photoDetail !== undefined,
      ...(notices === undefined ? {} : { notices }),
    };
    if (await commitTraceOutput(outputArgs, ctx, commitTraced, liveProject)) ctx.close();
  } catch (err) {
    reportTraceCommitError(args.seed.source, err, ctx);
  } finally {
    releaseTraceCommitBusy(ctx);
  }
}

function reportTraceCommitError(source: string, err: unknown, ctx: TraceCommitContext): void {
  if (ctx.claimOwner() === null) return;
  if (isTraceRequestSuperseded(err)) return;
  if (isTraceAbort(err)) return;
  settleTracePreview(ctx, { kind: 'error', error: err });
  ctx.pushToast(
    `Could not trace ${source}: ${err instanceof Error ? err.message : String(err)}`,
    'error',
  );
}

function releaseTraceCommitBusy(ctx: TraceCommitContext): void {
  if (ctx.claimOwner() !== null) ctx.setBusy(false);
}

function settleTracePreview(ctx: TraceCommitContext, outcome: TracePreviewCommitUpdate): void {
  ctx.settlePreview?.(outcome);
}

/** Compare trace-source content and pixel grids while intentionally allowing a
 * transform-only change. A true result narrows `live` to the current
 * `RasterImage`, whose transform can then register the trace at commit. */
export { sameTraceSourceContent as sameTraceSource } from './trace-commit-ownership';

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
