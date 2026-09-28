// Works out Optimize Shapes (LightBurn gap LBG-T22) for the dialog's status
// line without holding up the page: a short pause after each change of
// settings, then a slice of work per timer tick until the plan is done. A big
// trace reports how far it has got meanwhile; new settings drop the old work.

import { useEffect, useState } from 'react';
import type { ShapeOptimizeOptions } from '../../core/geometry/shape-optimize/shape-optimize-options';
import type { VectorSceneObject } from '../../core/geometry/vector-path-tools';
import { startOptimizeShapes, type OptimizeShapesPlan } from '../state/optimize-shapes-plan';

export type OptimizeShapesPreview =
  | { readonly kind: 'measuring'; readonly progress: number }
  | {
      readonly kind: 'ready';
      readonly plan: OptimizeShapesPlan;
      /** Time spent working it out, not counting the pauses between slices. */
      readonly busyMs: number;
    };

// Long enough to type a number without starting over on every key.
const SETTLE_MS = 150;
// Short enough that the dialog keeps answering between slices.
const SLICE_MS = 30;

type Tracked = {
  readonly targets: ReadonlyArray<VectorSceneObject>;
  readonly options: ShapeOptimizeOptions;
  readonly preview: OptimizeShapesPreview;
};

/** `options` should keep its identity until the settings change (memoize it). */
export function useOptimizeShapesPreview(
  targets: ReadonlyArray<VectorSceneObject>,
  options: ShapeOptimizeOptions,
): OptimizeShapesPreview {
  const [tracked, setTracked] = useState<Tracked | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = startOptimizeShapes(targets, options);
    let busyMs = 0;
    const slice = (): void => {
      if (cancelled) return;
      const started = performance.now();
      const done = run.advance(SLICE_MS);
      busyMs += performance.now() - started;
      if (done) {
        setTracked({ targets, options, preview: { kind: 'ready', plan: run.plan(), busyMs } });
        return;
      }
      setTracked({ targets, options, preview: { kind: 'measuring', progress: run.progress() } });
      timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, SETTLE_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [targets, options]);
  return tracked !== null && tracked.targets === targets && tracked.options === options
    ? tracked.preview
    : { kind: 'measuring', progress: 0 };
}
