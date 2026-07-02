// Module root for src/core/controllers — the firmware-neutral driver seam
// (ADR-094). Firmware-specific modules keep their own index (./grbl); this
// index exports only the cross-firmware surface the rest of the app uses.

export type { ControllerEvent } from './controller-event';
export type {
  ControllerCapabilities,
  FirmwareSetupPanel,
  JogCapability,
  SettingsCapability,
  StatusQueryCapability,
  WcsCapability,
} from './controller-capabilities';
export type {
  ConsoleQuickCommand,
  ControllerCommands,
  ControllerDriver,
  ControllerRealtime,
  FrameBounds,
} from './controller-driver';
export { selectControllerDriver } from './select-controller-driver';
export { detectControllerFromBanner } from './detect-controller';
export { grblDriver, GRBL_DEFAULT_BAUD_RATE, GRBL_SETTLE_DWELL } from './grbl/driver';
export { grblHalDriver } from './grblhal/driver';
export { fluidncDriver } from './fluidnc/driver';
export { marlinDriver, MARLIN_DEFAULT_BAUD_RATE } from './marlin/driver';
