// use-design-carve-content — the sketch, as viewer content (ADR-271
// Amendment 1 clause 4, instant tier). Pure math on a deferred sketch: typing
// and dragging stay snappy because the heightmap recomputes behind
// useDeferredValue, the same trick Cnc3DPane uses (PRF-01 also applies here —
// every selector below returns a stable reference).

import { useDeferredValue, useMemo } from 'react';
import { designCarveHeightmap, MIN_CARVE_CELL_MM } from '../../../core/design-carve';
import { steppedSurfaceMesh } from '../../../core/heightfield';
import { useStore } from '../../state';
import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import { useDesignStudioStore } from '../design-studio-store';
import { designCarveSource, type DesignCarveSource } from './design-carve-source';

// The stepped builder emits several times a smooth grid's vertices, so the
// carve grid targets the same display budget the CNC pane downsamples to.
const TARGET_CELLS_PER_AXIS = 300;

export type DesignCarveContent = {
  readonly content: ViewerContentInput;
  readonly source: DesignCarveSource;
};

export function useDesignCarveContent(): DesignCarveContent | null {
  const sketch = useDesignStudioStore((state) =>
    state.session === null ? null : state.session.history.present,
  );
  const project = useStore((state) => state.project);
  const deferredSketch = useDeferredValue(sketch);

  const source = useMemo(() => designCarveSource(project), [project]);

  return useMemo(() => {
    if (deferredSketch === null) return null;
    const { stock } = source;
    const mmPerCell = Math.max(
      MIN_CARVE_CELL_MM,
      Math.max(stock.widthMm, stock.heightMm) / TARGET_CELLS_PER_AXIS,
    );
    const heightmap = designCarveHeightmap({
      sketch: deferredSketch,
      stock,
      mmPerCell,
      tools: source.tools,
      activeTool: source.activeTool,
    });
    const content: ViewerContentInput = {
      mesh: steppedSurfaceMesh(heightmap),
      stockThicknessMm: stock.thicknessMm,
      ...(source.materialKey === undefined ? {} : { materialKey: source.materialKey }),
    };
    return { content, source };
  }, [deferredSketch, source]);
}
