// Dot-width advisory (ADR-246, V2 plan E2) — warnings, never blocks. It uses
// the same horizontal-run survival rule as the raster emitter and reports
// only ink runs that current Image-mode dot-width correction would erase.
// One-click Thicken restores those runs as one undoable history entry.

import { pushHistoryEntry } from '../../core/image-edit';
import {
  expandMask,
  fillMaskedInPlace,
  maskBounds,
  type SelectionMask,
} from '../../core/image-select';
import { rasterRunSurvivesDotWidthCorrection } from '../../core/raster/raster-sweep-plan';
import type { Project } from '../../core/scene';
import { BLACK, captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

const INK_LUMA_THRESHOLD = 128;
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export type KerfCheck = {
  /** Ink pixels in runs that dot-width correction fully removes. */
  readonly removedPixels: number;
  readonly thresholdMm: number;
  readonly removedMask: SelectionMask;
  readonly correctionPx: number;
};

/**
 * Null when the object has no Image-mode assignment or no effective
 * dot-width correction. Line-mode kerf offset is intentionally irrelevant.
 */
export function computeKerfCheck(session: EditorSession, project: Project): KerfCheck | null {
  const thresholdMm = dotWidthThresholdMm(session, project);
  if (thresholdMm === null) return null;
  const mmPerPx =
    (session.sourceBounds.maxX - session.sourceBounds.minX) / Math.max(1, session.base.width);
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  const correctionPx = Math.max(1, Math.ceil(thresholdMm / mmPerPx));
  const ink = inkMask(session);
  const removed = removedRunMask(ink, mmPerPx, thresholdMm);
  return {
    removedPixels: removed.pixels,
    thresholdMm,
    removedMask: removed.mask,
    correctionPx,
  };
}

function removedRunMask(
  ink: SelectionMask,
  mmPerPx: number,
  thresholdMm: number,
): { readonly mask: SelectionMask; readonly pixels: number } {
  let pixels = 0;
  const alpha = new Uint8Array(ink.alpha.length);
  for (let y = 0; y < ink.height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= ink.width; x += 1) {
      const isInk = x < ink.width && (ink.alpha[y * ink.width + x] ?? 0) > 0;
      if (isInk && runStart === -1) runStart = x;
      if (isInk || runStart === -1) continue;
      const runPixels = x - runStart;
      if (!rasterRunSurvivesDotWidthCorrection(0, runPixels * mmPerPx, false, thresholdMm)) {
        for (let markX = runStart; markX < x; markX += 1) {
          alpha[y * ink.width + markX] = 255;
          pixels += 1;
        }
      }
      runStart = -1;
    }
  }
  return { mask: { width: ink.width, height: ink.height, alpha }, pixels };
}

/** Thicken every removed run enough to survive correction — one undo entry. */
export function applyThicken(check: KerfCheck): void {
  const store = useImageEditorStore.getState();
  const session = store.session;
  if (session === null || check.removedPixels === 0) return;
  const grown = expandMask(check.removedMask, check.correctionPx);
  const bounds = maskBounds(grown);
  if (bounds === null) return;
  const entry = captureScoped(session, bounds, 'Thicken dot-width runs');
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

function dotWidthThresholdMm(session: EditorSession, project: Project): number | null {
  const found = project.scene.objects.find((candidate) => candidate.id === session.objectId);
  const object = found?.kind === 'raster-image' ? found : undefined;
  const layer =
    object === undefined
      ? undefined
      : project.scene.layers.find((candidate) => candidate.color === object.color);
  if (object === undefined || layer === undefined) return null;
  const effective = { ...layer, ...object.operationOverride };
  if (
    effective.mode !== 'image' ||
    !Number.isFinite(effective.linesPerMm) ||
    effective.linesPerMm <= 0
  ) {
    return null;
  }
  const threshold = Math.min(Math.max(0, effective.dotWidthCorrectionMm), 1 / effective.linesPerMm);
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
