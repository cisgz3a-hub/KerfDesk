import type { AirAssistCommand, DeviceGcodeDialect, DeviceProfile } from '../devices';

export type ResolvedGcodeDialect = DeviceGcodeDialect & {
  readonly airAssistCommand: AirAssistCommand;
};

const DEFAULT_GRBL_DIALECT: DeviceGcodeDialect = {
  dialectId: 'grbl-compatible',
  returnToOriginOnEnd: true,
  emitSOnTravel: true,
  emitSOnEveryBurnMove: false,
  modalFeedrate: true,
  airAssistCommand: 'none',
  laserModeCommand: 'mixed',
};

export const GRBL_DIALECT_CATALOG: ReadonlyArray<DeviceGcodeDialect> = [
  DEFAULT_GRBL_DIALECT,
  {
    dialectId: 'grbl-dynamic',
    returnToOriginOnEnd: true,
    emitSOnTravel: true,
    emitSOnEveryBurnMove: true,
    modalFeedrate: true,
    airAssistCommand: 'none',
    laserModeCommand: 'M4',
  },
  {
    dialectId: 'grbl-raster',
    returnToOriginOnEnd: true,
    emitSOnTravel: true,
    emitSOnEveryBurnMove: false,
    modalFeedrate: true,
    airAssistCommand: 'none',
    laserModeCommand: 'mixed',
  },
  {
    dialectId: 'neotronics-4040-safe',
    returnToOriginOnEnd: false,
    emitSOnTravel: true,
    controlledLaserOffTravelFeedMmPerMin: 800,
    emitSOnEveryBurnMove: true,
    modalFeedrate: false,
    airAssistCommand: 'none',
    laserModeCommand: 'M4',
  },
];

export function resolveGcodeDialectById(dialectId: string): DeviceGcodeDialect {
  return (
    GRBL_DIALECT_CATALOG.find((dialect) => dialect.dialectId === dialectId) ??
    DEFAULT_GRBL_DIALECT
  );
}

export function resolveGcodeDialect(device: DeviceProfile): ResolvedGcodeDialect {
  const baseDialect = resolveGcodeDialectById(device.gcodeDialect.dialectId);
  return {
    ...baseDialect,
    ...device.gcodeDialect,
    // The legacy editable DeviceProfile field remains the source of truth for
    // coolant output so existing device-settings UI changes keep affecting
    // emitted G-code without requiring users to edit a nested dialect object.
    airAssistCommand: device.airAssistCommand,
  };
}
