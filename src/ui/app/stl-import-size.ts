// The size an imported STL lands at (ADR-580). An STL carries millimetres by
// convention, so the model comes in at its own size with every axis at one
// scale: a 3D model keeps its proportions, and its height becomes the relief
// depth. Two cases are scaled, uniformly and disclosed:
//
// - larger than the bed: shrunk to fit it, as other imports are, but through
//   the relief's width and depth rather than its placement scale, which would
//   leave the depth at full size;
// - under a millimetre across: almost certainly not modelled in millimetres,
//   so it is brought to the default relief width.
//
// A flat model has no height to keep and takes the default depth. A model
// taller than the stock is not rescaled; the import says so.

import type { MeshBounds } from '../../core/relief';
import { DEFAULT_RELIEF_DEPTH_MM, DEFAULT_RELIEF_WIDTH_MM } from './relief-import-defaults';

const MIN_MODEL_MM = 1;

export type StlImportTarget = {
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  /** CNC stock thickness, when the project is a CNC project. */
  readonly stockThicknessMm?: number;
};

export type StlImportSize = {
  readonly targetWidthMm: number;
  readonly heightMm: number;
  readonly reliefDepthMm: number;
  /** Millimetres per model unit: 1 at the model's own size. */
  readonly scale: number;
  readonly reason: 'model-size' | 'fit-bed' | 'tiny-model';
  readonly flat: boolean;
};

export function stlImportSize(bounds: MeshBounds, target: StlImportTarget | null): StlImportSize {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const tall = bounds.maxZ - bounds.minZ;
  let scale = 1;
  let reason: StlImportSize['reason'] = 'model-size';
  if (Math.max(width, height) < MIN_MODEL_MM) {
    scale = DEFAULT_RELIEF_WIDTH_MM / width;
    reason = 'tiny-model';
  }
  if (target !== null && validBed(target)) {
    const fit = Math.min(
      target.bedWidthMm / (width * scale),
      target.bedHeightMm / (height * scale),
    );
    if (fit < 1) {
      scale *= fit;
      reason = 'fit-bed';
    }
  }
  const depth = tall * scale;
  const flat = !(depth > 0) || !Number.isFinite(depth);
  const targetWidthMm = width * scale;
  return {
    targetWidthMm,
    // The same expression meshToHeightmap sizes the relief's rows with.
    heightMm: (height / width) * targetWidthMm,
    reliefDepthMm: flat ? DEFAULT_RELIEF_DEPTH_MM : depth,
    scale,
    reason,
    flat,
  };
}

function validBed(target: StlImportTarget): boolean {
  return (
    Number.isFinite(target.bedWidthMm) &&
    target.bedWidthMm > 0 &&
    Number.isFinite(target.bedHeightMm) &&
    target.bedHeightMm > 0
  );
}

const MAX_FORMAT_DECIMALS = 2;

function mm(value: number): string {
  return String(Number(value.toFixed(MAX_FORMAT_DECIMALS)));
}

/** The import toast's size sentence and any notice the size needs. */
export function describeStlImportSize(
  size: StlImportSize,
  target: StlImportTarget | null,
): { readonly sizeText: string; readonly notice: string | null } {
  const sizeText =
    `${mm(size.targetWidthMm)} × ${mm(size.heightMm)} mm and ${mm(size.reliefDepthMm)} mm deep` +
    (size.reason === 'model-size' ? ' (its own size)' : '');
  const notices = [scaleNotice(size, target), flatNotice(size), stockNotice(size, target)].filter(
    (notice): notice is string => notice !== null,
  );
  return { sizeText, notice: notices.length === 0 ? null : notices.join(' ') };
}

function scaleNotice(size: StlImportSize, target: StlImportTarget | null): string | null {
  if (size.reason === 'fit-bed') {
    return (
      `It was larger than the ${mm(target?.bedWidthMm ?? 0)} × ${mm(target?.bedHeightMm ?? 0)} mm bed, ` +
      `so every axis was scaled to ${mm(size.scale * 100)}% to fit; its proportions are kept.`
    );
  }
  if (size.reason === 'tiny-model') {
    return (
      'It measured under 1 mm across, so it was probably not modelled in millimetres; ' +
      `every axis was scaled to make it ${mm(DEFAULT_RELIEF_WIDTH_MM)} mm wide.`
    );
  }
  return null;
}

function flatNotice(size: StlImportSize): string | null {
  return size.flat ? `It has no height, so its depth is ${mm(size.reliefDepthMm)} mm.` : null;
}

function stockNotice(size: StlImportSize, target: StlImportTarget | null): string | null {
  const stock = target?.stockThicknessMm;
  if (stock === undefined || !(stock > 0) || !(size.reliefDepthMm > stock)) return null;
  return (
    `It is ${mm(size.reliefDepthMm)} mm tall, more than the ${mm(stock)} mm stock: reduce its ` +
    'Width or Depth in Relief properties (proportions stay locked), use thicker stock, or ' +
    'split it for two-sided carving.'
  );
}
