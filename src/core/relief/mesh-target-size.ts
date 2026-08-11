type MeshTargetSizeInput = {
  readonly targetWidthMm: number;
  readonly targetHeightMm?: number;
  readonly reliefDepthMm: number;
  readonly targetScaleX?: number;
  readonly targetScaleY?: number;
};

export type MeshTargetSizeResult =
  | { readonly kind: 'ok'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'error'; readonly reason: string };

/** Resolves explicit or intrinsic-aspect mesh target dimensions before grid allocation. */
export function meshTargetSize(
  input: MeshTargetSizeInput,
  intrinsicAspect: number,
): MeshTargetSizeResult {
  if (!positiveFinite(input.targetWidthMm) || !positiveFinite(input.reliefDepthMm)) {
    return {
      kind: 'error',
      reason: 'Target width and relief depth must be finite positive numbers.',
    };
  }
  const targetHeightMm = input.targetHeightMm ?? intrinsicAspect * input.targetWidthMm;
  if (!positiveFinite(targetHeightMm)) {
    return { kind: 'error', reason: 'Target height must be a finite positive number.' };
  }
  const targetScaleX = input.targetScaleX ?? 1;
  const targetScaleY = input.targetScaleY ?? 1;
  if (!positiveFinite(targetScaleX) || !positiveFinite(targetScaleY)) {
    return { kind: 'error', reason: 'Target XY scale must be finite and positive.' };
  }
  return {
    kind: 'ok',
    widthMm: input.targetWidthMm * targetScaleX,
    heightMm: targetHeightMm * targetScaleY,
  };
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
