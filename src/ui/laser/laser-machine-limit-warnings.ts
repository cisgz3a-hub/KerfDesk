// detectLaserMachineLimitWarnings — the laser sibling of
// detectCncMachineLimitWarnings (DEV-06). Laser jobs never cross-checked the
// device profile against the connected controller's live-reported travel, so a
// stale or mistyped profile bed larger than the real work area passed every gate
// (bounds preflight tests the profile bed alone). This compares the profile's
// work area against the reported $130/$131 travel and the fastest output-layer
// speed against the reported $110/$111 max rate. Advisory, never a gate — an
// operator who knows their real area or accepts firmware clamping may proceed.
// Pure: the detected snapshot is passed in (the laser store owns it).

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { Project } from '../../core/scene';

// A profile within float-noise / rounding of the reported travel must not nag.
const BED_TRAVEL_TOLERANCE_MM = 1;

export function detectLaserMachineLimitWarnings(
  project: Project,
  limits: ControllerSettingsSnapshot | null,
): ReadonlyArray<string> {
  // The CNC version (detectCncMachineLimitWarnings) owns the cnc kind and reads
  // the stock, not the device bed; bail here so the two never double-advise.
  if (limits === null || project.machine?.kind === 'cnc') return [];
  return [...bedVsTravel(project.device, limits), ...speedVsMax(project, limits)];
}

function bedVsTravel(
  device: DeviceProfile,
  limits: ControllerSettingsSnapshot,
): ReadonlyArray<string> {
  const over: string[] = [];
  if (
    limits.bedWidth !== undefined &&
    device.bedWidth > limits.bedWidth + BED_TRAVEL_TOLERANCE_MM
  ) {
    over.push(`width ${device.bedWidth} mm > ${limits.bedWidth} mm`);
  }
  if (
    limits.bedHeight !== undefined &&
    device.bedHeight > limits.bedHeight + BED_TRAVEL_TOLERANCE_MM
  ) {
    over.push(`height ${device.bedHeight} mm > ${limits.bedHeight} mm`);
  }
  if (over.length === 0) return [];
  return [
    `The device profile's work area exceeds the machine's reported travel ` +
      `(${over.join(', ')}) — a job using the full area will hit the axis limits.`,
  ];
}

function speedVsMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.maxFeed === undefined) return [];
  const topSpeed = maxOutputLayerSpeed(project);
  if (topSpeed === null || topSpeed <= limits.maxFeed) return [];
  return [
    `A layer's speed ${topSpeed} mm/min is above the machine's reported max rate ` +
      `${limits.maxFeed} mm/min — the controller clamps to its limit, so the job ` +
      'runs slower than planned.',
  ];
}

// The fastest speed among layers that actually emit (output on). Null when no
// output layer exists — nothing to compare, so no advisory. Layer speed is
// mm/min (layer.ts), the same unit as the reported max rate.
function maxOutputLayerSpeed(project: Project): number | null {
  const speeds = project.scene.layers.filter((layer) => layer.output).map((layer) => layer.speed);
  return speeds.length === 0 ? null : Math.max(...speeds);
}
