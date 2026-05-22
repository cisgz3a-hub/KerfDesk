import type { Axis } from './MachineIntent';

export type ControllerFamily = 'grbl' | 'falcon-wifi' | 'simulator' | 'unknown';

export interface ControllerProfile {
  readonly family: ControllerFamily;
  readonly firmwareVersion?: string;
  readonly softLimitsEnabled: boolean;
  readonly homingEnabled: boolean;
  readonly laserModeEnabled: boolean;
  readonly spindleMin: number;
  readonly spindleMax: number;
  readonly travelMm: Record<Axis, number | null>;
  readonly maxFeedMmPerMin: Record<Axis, number | null>;
  readonly supportsRealtime: boolean;
  readonly supportsJogCancel: boolean;
}

export type GrblDollarSettings = ReadonlyMap<string, number>;
