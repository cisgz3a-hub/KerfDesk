// Toolpath shared types — the step/route model consumed by the preview
// scrubber, distance summary, and (H.2) the CNC simulator. Split from
// toolpath.ts so the raster/slice/build modules can share them without
// import cycles.

import type { Vec2 } from '../scene';
import type { ScanOffsetPoint } from './scan-offset';

// Z extent of a step (CNC, Phase H.2). Laser steps omit it; CNC steps carry
// it so the simulator can depth-shade and the scrubber can report head Z.
export type ZSpan = { readonly from: number; readonly to: number };

export type ToolpathStep =
  | {
      readonly kind: 'travel';
      readonly from: Vec2;
      readonly to: Vec2;
      readonly length: number;
      readonly z?: ZSpan;
    }
  | {
      readonly kind: 'cut';
      readonly color: string;
      readonly source?: RasterToolpathSource;
      readonly polyline: ReadonlyArray<Vec2>;
      readonly length: number;
      readonly z?: ZSpan;
      readonly groupId?: string;
      readonly passIndex?: number;
    }
  // Vertical-only move at a fixed XY: a CNC plunge (toZ < fromZ) or retract
  // (toZ > fromZ). length = |Δz| so the scrubber advances through it.
  | {
      readonly kind: 'plunge';
      readonly at: Vec2;
      readonly fromZ: number;
      readonly toZ: number;
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
  // Vertical plunge/retract distance (CNC only; 0 for laser jobs).
  readonly plungeMm: number;
  readonly totalMm: number;
};

// Slice result: steps to render whole, the partial step (if the cut lands
// mid-segment) with truncated geometry, and the head position.
export type SlicedToolpath = {
  readonly whole: ReadonlyArray<ToolpathStep>;
  readonly partial: ToolpathStep | null;
  readonly head: Vec2 | null;
};
