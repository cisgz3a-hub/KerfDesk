/** Source contributions for one output coordinate. */
export type AxisTap = { readonly index: number; readonly weight: number };

/** Area coverage when shrinking; pixel-centre linear interpolation otherwise. */
export function axisContributions(
  sourceSize: number,
  targetSize: number,
): readonly (readonly AxisTap[])[] {
  const scale = sourceSize / targetSize;
  return Array.from({ length: targetSize }, (_, pixel) => {
    if (scale <= 1) return linearTaps(sourceSize, (pixel + 0.5) * scale - 0.5);
    const start = pixel * scale;
    const end = (pixel + 1) * scale;
    const taps: AxisTap[] = [];
    for (let index = Math.floor(start); index < Math.min(sourceSize, Math.ceil(end)); index += 1) {
      const weight = (Math.min(end, index + 1) - Math.max(start, index)) / scale;
      if (weight > 0) taps.push({ index, weight });
    }
    return taps;
  });
}

function linearTaps(size: number, coordinate: number): readonly AxisTap[] {
  const clamped = Math.max(0, Math.min(size - 1, coordinate));
  const first = Math.floor(clamped);
  const fraction = clamped - first;
  if (fraction === 0) return [{ index: first, weight: 1 }];
  return [
    { index: first, weight: 1 - fraction },
    { index: first + 1, weight: fraction },
  ];
}
