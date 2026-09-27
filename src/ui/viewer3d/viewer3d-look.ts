// The two looks of the G-code 3D view (ADR-426). Classic is the pale-line
// look operators already know and stays the default. Studio is the second
// look: lit tool models, a job box with sizes, a fading floor grid, and
// colours that show exactly what their legend says.

import type { AxisBounds } from '../../core/gcode-view';
import type { ToolProfilePoint } from '../../core/sim';

export const VIEWER3D_LOOKS = ['classic', 'studio'] as const;
export type Viewer3dLook = (typeof VIEWER3D_LOOKS)[number];

export const VIEWER3D_LOOK_LABEL: Readonly<Record<Viewer3dLook, string>> = {
  classic: 'Classic',
  studio: 'Studio',
};

/** What the playhead marker shows in Studio. */
export type StudioToolSpec =
  | { readonly kind: 'laser' }
  | {
      readonly kind: 'bit';
      /** Half-silhouette from core/sim toolProfile, tip at height 0. */
      readonly profile: ReadonlyArray<ToolProfilePoint>;
      readonly shankDiameterMm: number;
    }
  /** Unknown machine or bit: Studio keeps the Classic marker rather than guess. */
  | { readonly kind: 'none' };

/** An XY rectangle in program coordinates, mm. */
export type Viewer3dRect = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

/** Everything the scene needs to dress the job for a look. */
export type Viewer3dStage = {
  readonly look: Viewer3dLook;
  /** The box the cutting moves fill; null when the program never cuts. */
  readonly jobBox: AxisBounds | null;
  /** The machine's bed in program coordinates, only when that frame is known. */
  readonly workArea: Viewer3dRect | null;
  readonly tool: StudioToolSpec;
};

export const CLASSIC_STAGE: Viewer3dStage = {
  look: 'classic',
  jobBox: null,
  workArea: null,
  tool: { kind: 'none' },
};

/**
 * sRGB channel (0 to 1) to linear light. The line shaders treat vertex
 * colours as linear and encode them on output, so Studio hands them linear
 * values and the lines show their sRGB colour exactly (ADR-426). Classic keeps
 * the raw values and its lighter lines (ADR-425).
 */
export function srgbToLinear(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.04045 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
}

/** Studio's dashed, recessive rapid colour; the legend swatch uses the same hex. */
export const STUDIO_TRAVEL_COLOR = 0xd08a7e;
