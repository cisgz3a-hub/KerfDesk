// FluidNC driver — GRBL-compatible wire protocol (banner "Grbl 3.x
// [FluidNC vX]"), same realtime bytes, jog, and status reports. The key
// delta: numeric `$N=value` writes are legacy-mapped or ignored by FluidNC
// (real configuration lives in the $/tree YAML config), so the settings
// capability is a read-only dump and the GRBL laser-setup panel is disabled.

import type { ControllerDriver } from '../controller-driver';
import { grblDriver } from '../grbl/driver';

export const fluidncDriver: ControllerDriver = {
  ...grblDriver,
  kind: 'fluidnc',
  label: 'FluidNC',
  commands: {
    ...grblDriver.commands,
    // FluidNC identity/build output is not the strict stock-GRBL `$I` shape.
    buildInfoQuery: null,
  },
  capabilities: {
    ...grblDriver.capabilities,
    settings: 'readonly-dump',
    firmwareSetupPanel: 'none',
  },
};
