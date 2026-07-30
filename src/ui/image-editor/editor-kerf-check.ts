// Dot-width advisory (ADR-246, V2 plan E2) — warnings, never blocks. It
// compiles the virtual Apply raster through the same adjustment, resampling,
// mask, orientation, dither, and exact-S sweep semantics as raster emission.
// One-click Thicken appears only for a reversible active-layer target.

import { pushHistoryEntry, type RgbaBuffer } from '../../core/image-edit';
import { fillMaskedInPlace, maskBounds } from '../../core/image-select';
import type { SelectionMask } from '../../core/image-select';
import type { JobPlacementSettings } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import { currentOutputScope, useStore, useToastStore } from '../state';
import {
  computeKerfOutputParity,
  type KerfOutputParity,
  type KerfOutputParityInput,
} from './editor-kerf-output-parity';
import { editorKerfThickenTarget } from './editor-kerf-thicken-target';
import { BLACK, appliedBounds, captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';
import {
  isKerfCheckContextCurrent,
  kerfCheckContext,
  kerfOperationLayer,
  type KerfCheckContext,
} from './kerf-check-context';

/** Output-facing dot-width loss plus any reversible editor repair. */
export type KerfCheck = {
  /** Compiled output samples in exact-S runs erased by dot-width correction. */
  readonly removedPixels: number;
  readonly minCorrectionMm: number;
  readonly maxCorrectionMm: number;
  /** Null when no reversible active-layer edit target can be proven. */
  readonly removedMask: SelectionMask | null;
  readonly context: KerfCheckContext;
};

/**
 * Synchronous pure entry for focused ownership tests. Product UI runs the
 * output-parity core in a dedicated worker instead of calling this path.
 */
export function computeKerfCheck(
  session: EditorSession,
  project: Project,
  outputScope: OutputScope,
  jobPlacement: JobPlacementSettings,
): KerfCheck | null {
  const context = kerfCheckContext(session, project, outputScope, jobPlacement);
  if (context === null) return null;
  const parity = computeKerfOutputParity(
    kerfOutputParityInput(session, compositeSession(session), context),
  );
  return parity === null ? null : kerfCheckFromParity(session, context, parity);
}

/** Build the minimal worker input from one cached Apply-equivalent composite. */
export function kerfOutputParityInput(
  session: EditorSession,
  composite: RgbaBuffer,
  context: KerfCheckContext,
): KerfOutputParityInput {
  return {
    composite,
    object: workerRasterObject(context.object),
    layers: context.layers,
    maskObject: context.maskObject,
    device: context.device,
    appliedBounds: appliedBounds(session) ?? context.object.bounds,
  };
}

function workerRasterObject(object: KerfCheckContext['object']): KerfCheckContext['object'] {
  const { dataUrl: _dataUrl, lumaBase64: _lumaBase64, ...metadata } = object;
  // The worker replaces luma from the transferred Apply composite. Avoid
  // synchronously cloning the redundant source bitmap/base64 payload.
  return { ...metadata, dataUrl: '' };
}

/** Bind one worker result back to its still-current main-thread ownership. */
export function kerfCheckFromParity(
  session: EditorSession,
  context: KerfCheckContext,
  parity: KerfOutputParity,
): KerfCheck | null {
  if (parity.removedPixels === 0) return null;
  const candidate = parity.thickenCandidate;
  const layer = candidate === null ? null : kerfOperationLayer(context, candidate.group.layerId);
  const target =
    candidate === null || layer === null
      ? null
      : editorKerfThickenTarget({
          session,
          object: context.object,
          layer,
          group: candidate.group,
          device: context.device,
          removed: candidate.removed,
        });
  return {
    removedPixels: parity.removedPixels,
    minCorrectionMm: parity.minCorrectionMm,
    maxCorrectionMm: parity.maxCorrectionMm,
    removedMask: target?.mask ?? null,
    context,
  };
}

/** Thicken every reversibly mapped removed run in one undo entry. */
export function applyThicken(check: KerfCheck): void {
  const store = useImageEditorStore.getState();
  const session = store.session;
  if (session === null || check.removedPixels === 0 || check.removedMask === null) return;
  const app = useStore.getState();
  if (
    !isKerfCheckContextCurrent(
      check.context,
      session,
      app.project,
      currentOutputScope(app),
      app.jobPlacement,
    )
  ) {
    useToastStore
      .getState()
      .pushToast(
        'The image or output selection changed; the dot-width check is refreshing.',
        'info',
      );
    return;
  }
  const bounds = maskBounds(check.removedMask);
  if (bounds === null) return;
  const entry = captureScoped(session, bounds, 'Thicken dot-width runs');
  fillMaskedInPlace(session.doc, check.removedMask, BLACK);
  useImageEditorStore.setState({
    session: {
      ...session,
      history: pushHistoryEntry(session.history, entry),
      revision: session.revision + 1,
      dirtySinceApply: true,
      lastDirtyRect: bounds,
    },
  });
}
