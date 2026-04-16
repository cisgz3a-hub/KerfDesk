import type { DitherMode } from '../../import/Dithering';

export interface MaterialOperation {
  power: number; // percentage 0–100
  speed: number; // mm/min
  passes: number;
  dithering?: DitherMode;
  dpi?: number;
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
}
