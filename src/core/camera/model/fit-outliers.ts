// Outlier handling for the camera fit (ADR-440): after a robust pass, points
// whose reprojection error is far above the typical one are dropped once and
// the fit is repeated; the dropped points come back as NaN in the per-point
// report so the caller can show which marks were ignored. Pure core.

const OUTLIER_FLOOR_PX = 2;
const OUTLIER_MEDIAN_FACTOR = 5;

type View<T> = { readonly points: ReadonlyArray<T> };

export type KeptViews<T> = {
  readonly views: ReadonlyArray<View<T>>;
  readonly keptIndex: ReadonlyArray<ReadonlyArray<number>>;
  readonly dropped: number;
};

export function dropOutliers<T>(
  views: ReadonlyArray<View<T>>,
  residuals: ReadonlyArray<ReadonlyArray<number>>,
  minPointsPerView: number,
): KeptViews<T> {
  const all = residuals.flat().sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] ?? 0;
  const limit = Math.max(OUTLIER_FLOOR_PX, OUTLIER_MEDIAN_FACTOR * median);
  let dropped = 0;
  const keptIndex: number[][] = [];
  const kept = views.map((view, v) => {
    const indices: number[] = [];
    view.points.forEach((_, i) => {
      if ((residuals[v]?.[i] ?? 0) <= limit) indices.push(i);
      else dropped += 1;
    });
    keptIndex.push(indices);
    return { points: indices.map((i) => view.points[i] as T) };
  });
  const enough = kept.every((view) => view.points.length >= minPointsPerView);
  return enough ? { views: kept, keptIndex, dropped } : { views, keptIndex: [], dropped: 0 };
}

export function remapResiduals<T>(
  views: ReadonlyArray<View<T>>,
  keptIndex: ReadonlyArray<ReadonlyArray<number>>,
  keptResiduals: ReadonlyArray<ReadonlyArray<number>>,
): number[][] {
  return views.map((view, v) => {
    const row = new Array<number>(view.points.length).fill(Number.NaN);
    keptIndex[v]?.forEach((original, k) => (row[original] = keptResiduals[v]?.[k] ?? Number.NaN));
    return row;
  });
}
