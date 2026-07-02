// Toolpath shared types — the step/route model consumed by the preview
// scrubber, distance summary, and (H.2) the CNC simulator. Split from
// toolpath.ts so the raster/slice/build modules can share them without
// import cycles.

import type { Vec2 } from '../scene';
import type { ScanOffsetPoint } from './scan-offset';

export type ToolpathStep =
  | { readonly kind: 'travel'; readonly from: Vec2; readonly to: Vec2; readonly length: number }
  | {
      readonly kind: 'cut';
      readonly color: string;
      readonly source?: RasterToolpathSource;
      readonly polyline: ReadonlyArray<Vec2>;
      readonly length: number;
    };

export type RasterToolpathSource = {
  readonly kind: 'raster';
  readonly objectId?: string;
  readonly source?: string;
  readonly passIndex: number;
  readonly rowIndex: number;
  readonly spanIndex: number;
  readonly pixelStartX: number;
  readonly pixelEndX: number;
};

export type Toolpath = {
  readonly steps: ReadonlyArray<ToolpathStep>;
  readonly totalLength: number;
};

export type BuildToolpathOptions = {
  readonly startPoint?: Vec2;
  readonly parkPoint?: Vec2;
  readonly scanningOffsets?: ReadonlyArray<ScanOffsetPoint>;
};

export type ToolpathDistanceSummary = {
  readonly cutMm: number;
  readonly travelMm: number;
  readonly totalMm: number;
};

// Slice result: steps to render whole, the partial step (if the cut lands
// mid-segment) with truncated geometry, and the head position.
export type SlicedToolpath = {
  readonly whole: ReadonlyArray<ToolpathStep>;
  readonly partial: ToolpathStep | null;
  readonly head: Vec2 | null;
};
