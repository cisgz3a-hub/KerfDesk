import type { DitherMode } from '../../import/Dithering';
import type { ResponseCurve } from './ResponseCurve';

export interface MaterialOperation {
  power: number; // percentage 0–100
  speed: number; // mm/min
  passes: number;
  dithering?: DitherMode;
  dpi?: number;
  /** Threshold for dither/image mode (0–255). OPTIONAL. */
  threshold?: number;
  /** Per-operation air-assist override. OPTIONAL. */
  airAssist?: boolean;
}

export interface MaterialPreset {
  id: string;
  name: string;
  material: string;
  thickness: string;
  laserWattage: string;
  operations: {
    cut?: MaterialOperation;
    engrave?: MaterialOperation;
    score?: MaterialOperation;
  };

  /**
   * Kerf offset in mm. Positive expands outer shapes / shrinks holes.
   * Applied at compile time to closed paths. Layer-level kerf overrides
   * this when set. OPTIONAL — undefined = no kerf compensation.
   */
  kerf?: number;

  /** Lead-in distance in mm for cut layers. OPTIONAL. */
  leadIn?: number;

  /**
   * Z-axis offset in mm applied before running the preset.
   * Negative = lower head. OPTIONAL.
   */
  zOffset?: number;

  /**
   * Tabs/bridges config for cut layers. When present, overrides
   * layer-level tabs settings during compile. OPTIONAL.
   */
  tabs?: {
    enabled: boolean;
    count: number;
    width: number;
    height: number;
  };

  /**
   * D.13 material response curve measured on this material.
   * When present, JobCompiler uses this for power remapping on
   * engrave/image layers. OPTIONAL — undefined = no calibration.
   */
  responseCurve?: ResponseCurve;
}
