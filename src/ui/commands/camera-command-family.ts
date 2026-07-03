// camera-command-family — the single Tools-menu / toolbar command for Camera
// Mode (ADR-107): a toggle that opens or closes the floating camera panel.
// Every actual camera action (pick a device, calibrate, align, trace) lives in
// the panel itself (CameraPanel), not in the command registry — mirroring the
// registration-jig command.

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function cameraCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'tools.camera',
      'tools',
      'Camera',
      ctx.cameraPanelOpen
        ? 'Close the camera panel'
        : 'Open the camera panel — overhead-camera alignment, calibration, and overlay',
      ctx.toggleCameraPanel,
    ),
    active: ctx.cameraPanelOpen,
  };
}
