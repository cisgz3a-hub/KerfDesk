// Kerf thin-stroke advisory (ADR-246, V2 plan E2) — warnings, never blocks
// (rule 7 / ADR-228). Composed ENTIRELY from existing core: the ink mask of
// the composite is morphologically opened (contract then expand) by the
// layer's kerf radius; ink pixels the opening loses are strokes thinner
// than the beam. One-click Thicken paints them back out to the kerf as one
// undoable history entry. Nothing here refuses anything.

import { pushHistoryEntry } from '../../core/image-edit';
import {
  contractMask,
  expandMask,
  fillMaskedInPlace,
  maskBounds,
  type SelectionMask,
} from '../../core/image-select';
import type { Project } from '../../core/scene';
import { BLACK, captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

const INK_LUMA_THRESHOLD = 128;
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export type KerfCheck = {
  /** Ink pixels thinner than the kerf (0 = all strokes survive the beam). */
  readonly thinPixels: number;
  readonly thresholdMm: number;
  /** The thin pixels, for Thicken (and a future overlay). */
  readonly thinMask: SelectionMask;
  readonly kerfPx: number;
};

/**
 * Null when the object's layer declares no kerf/dot width (nothing to
 * check against) or the object has no Image-mode layer assignment.
 */
export function computeKerfCheck(session: EditorSession, project: Project): KerfCheck | null {
  const thresholdMm = kerfThresholdMm(session, project);
  if (thresholdMm === null) return null;
  const mmPerPx =
    (session.sourceBounds.maxX - session.sourceBounds.minX) / Math.max(1, session.base.width);
  const kerfPx = Math.max(1, Math.round(thresholdMm / Math.max(mmPerPx, 1e-6) / 2));
  const ink = inkMask(session);
  const opened = expandMask(contractMask(ink, kerfPx), kerfPx);
  let thinPixels = 0;
  const alpha = new Uint8Array(ink.alpha.length);
  for (let i = 0; i < ink.alpha.length; i += 1) {
    if ((ink.alpha[i] ?? 0) > 0 && (opened.alpha[i] ?? 0) === 0) {
      alpha[i] = 255;
      thinPixels += 1;
    }
  }
  return {
    thinPixels,
    thresholdMm,
    thinMask: { width: ink.width, height: ink.height, alpha },
    kerfPx,
  };
}

/** Thicken every thin region out to the kerf — one undoable entry. */
export function applyThicken(check: KerfCheck): void {
  const store = useImageEditorStore.getState();
  const session = store.session;
  if (session === null || check.thinPixels === 0) return;
  const grown = expandMask(check.thinMask, check.kerfPx);
  const bounds = maskBounds(grown);
  if (bounds === null) return;
  const entry = captureScoped(session, bounds, 'Thicken thin strokes');
  fillMaskedInPlace(session.doc, grown, BLACK);
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

// The advisory threshold: the layer's kerf offset, else its dot-width
// correction; nothing declared = nothing to warn against.
function kerfThresholdMm(session: EditorSession, project: Project): number | null {
  const found = project.scene.objects.find((candidate) => candidate.id === session.objectId);
  const object = found?.kind === 'raster-image' ? found : undefined;
  const layer =
    object === undefined
      ? undefined
      : project.scene.layers.find((candidate) => candidate.color === object.color);
  if (object === undefined || layer === undefined) return null;
  const effective = { ...layer, ...object.operationOverride };
  const threshold = Math.max(effective.kerfOffsetMm, effective.dotWidthCorrectionMm);
  return threshold > 0 ? threshold : null;
}

function inkMask(session: EditorSession): SelectionMask {
  const composite = compositeSession(session);
  const alpha = new Uint8Array(composite.width * composite.height);
  for (let i = 0; i < alpha.length; i += 1) {
    const base = i * 4;
    const luma =
      LUMA_R * (composite.data[base] ?? 0) +
      LUMA_G * (composite.data[base + 1] ?? 0) +
      LUMA_B * (composite.data[base + 2] ?? 0);
    if (luma < INK_LUMA_THRESHOLD) alpha[i] = 255;
  }
  return { width: composite.width, height: composite.height, alpha };
}
