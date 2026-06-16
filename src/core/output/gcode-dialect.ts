import type { AirAssistCommand, DeviceGcodeDialect, DeviceProfile } from '../devices';

export type ResolvedGcodeDialect = DeviceGcodeDialect & {
  readonly airAssistCommand: AirAssistCommand;
};

export function resolveGcodeDialect(device: DeviceProfile): ResolvedGcodeDialect {
  return {
    ...device.gcodeDialect,
    // The legacy editable DeviceProfile field remains the source of truth for
    // coolant output so existing device-settings UI changes keep affecting
    // emitted G-code without requiring users to edit a nested dialect object.
    airAssistCommand: device.airAssistCommand,
  };
}
