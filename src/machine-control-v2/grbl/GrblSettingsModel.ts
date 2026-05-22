import type { Axis } from '../MachineIntent';
import type {
  ControllerFamily,
  ControllerProfile,
  GrblDollarSettings,
} from '../ControllerProfile';

export function parseGrblDollarSettings(
  lines: readonly string[],
): GrblDollarSettings {
  const settings = new Map<string, number>();

  for (const line of lines) {
    const match = line.trim().match(/^(\$\d+)=(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      continue;
    }
    settings.set(match[1], Number(match[2]));
  }

  return settings;
}

function setting(settings: GrblDollarSettings, key: string): number | null {
  return settings.has(key) ? settings.get(key)! : null;
}

function axisRecord(
  x: number | null,
  y: number | null,
  z: number | null,
  a: number | null = null,
): Record<Axis, number | null> {
  return { X: x, Y: y, Z: z, A: a };
}

export function toControllerProfile(args: {
  family: ControllerFamily;
  firmwareVersion?: string;
  settings: GrblDollarSettings;
}): ControllerProfile {
  const s = args.settings;

  return {
    family: args.family,
    firmwareVersion: args.firmwareVersion,
    softLimitsEnabled: setting(s, '$20') === 1,
    homingEnabled: setting(s, '$22') === 1,
    laserModeEnabled: setting(s, '$32') === 1,
    spindleMin: setting(s, '$31') ?? 0,
    spindleMax: setting(s, '$30') ?? 1000,
    travelMm: axisRecord(
      setting(s, '$130'),
      setting(s, '$131'),
      setting(s, '$132'),
      setting(s, '$133'),
    ),
    maxFeedMmPerMin: axisRecord(
      setting(s, '$110'),
      setting(s, '$111'),
      setting(s, '$112'),
      setting(s, '$113'),
    ),
    supportsRealtime: args.family === 'grbl',
    supportsJogCancel: args.family === 'grbl',
  };
}
