// Ink & time readout math (ADR-246, V2 plan E1): % ink coverage of the
// composite plus a rough engrave-time estimate from the object's assigned
// Image-mode layer (rows-with-ink × ink width ÷ speed × passes). Advisory
// numbers only — the Job Review / live estimate stays the authority.

import type { Project } from '../../core/scene';
import { compositeSession } from './editor-session-layers';
import type { EditorSession } from './editor-session';

const INK_LUMA_THRESHOLD = 128;
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const SECONDS_PER_MINUTE = 60;

export type InkTimeEstimate =
  | {
      readonly kind: 'estimated';
      readonly seconds: number;
      readonly layerName: string;
    }
  | { readonly kind: 'no-image-layer' };

export type InkTimeReadout = {
  /** Whole-percent ink coverage of the visible composite. */
  readonly inkPercent: number;
  readonly estimate: InkTimeEstimate;
};

type InkScan = {
  readonly inkPixels: number;
  readonly totalPixels: number;
  readonly inkRows: number;
  readonly minX: number;
  readonly maxX: number;
};

export function computeInkTimeReadout(session: EditorSession, project: Project): InkTimeReadout {
  const scan = scanInk(session);
  const inkPercent = Math.round((100 * scan.inkPixels) / Math.max(1, scan.totalPixels));
  return { inkPercent, estimate: estimateSeconds(session, project, scan) };
}

function scanInk(session: EditorSession): InkScan {
  const composite = compositeSession(session);
  let inkPixels = 0;
  let inkRows = 0;
  let minX = composite.width;
  let maxX = -1;
  for (let y = 0; y < composite.height; y += 1) {
    let rowHasInk = false;
    for (let x = 0; x < composite.width; x += 1) {
      const base = (y * composite.width + x) * 4;
      const luma =
        LUMA_R * (composite.data[base] ?? 0) +
        LUMA_G * (composite.data[base + 1] ?? 0) +
        LUMA_B * (composite.data[base + 2] ?? 0);
      if (luma >= INK_LUMA_THRESHOLD) continue;
      inkPixels += 1;
      rowHasInk = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (rowHasInk) inkRows += 1;
  }
  return {
    inkPixels,
    totalPixels: composite.width * composite.height,
    inkRows,
    minX,
    maxX,
  };
}

function estimateSeconds(session: EditorSession, project: Project, scan: InkScan): InkTimeEstimate {
  if (scan.inkPixels === 0) return { kind: 'no-image-layer' };
  const found = project.scene.objects.find((candidate) => candidate.id === session.objectId);
  const object = found?.kind === 'raster-image' ? found : undefined;
  const layer =
    object === undefined
      ? undefined
      : project.scene.layers.find((candidate) => candidate.color === object.color);
  if (object === undefined || layer === undefined) return { kind: 'no-image-layer' };
  // Same per-object override rule as compile-job-object-policy.
  const effective = { ...layer, ...object.operationOverride };
  if (effective.mode !== 'image' || effective.speed <= 0 || effective.linesPerMm <= 0) {
    return { kind: 'no-image-layer' };
  }
  const widthMm = session.sourceBounds.maxX - session.sourceBounds.minX;
  const heightMm = session.sourceBounds.maxY - session.sourceBounds.minY;
  const mmPerPxX = widthMm / session.base.width;
  const mmPerPxY = heightMm / session.base.height;
  const inkWidthMm = Math.max(1, scan.maxX - scan.minX + 1) * mmPerPxX;
  const machineRows = scan.inkRows * mmPerPxY * effective.linesPerMm;
  const rowSeconds = inkWidthMm / (effective.speed / SECONDS_PER_MINUTE);
  return {
    kind: 'estimated',
    seconds: machineRows * rowSeconds * Math.max(1, effective.passes),
    layerName: layer.name,
  };
}
