// detectLaserMachineLimitWarnings — the laser sibling of
// detectCncMachineLimitWarnings (DEV-06). Laser jobs never cross-checked the
// device profile against the connected controller's live-reported travel, so a
// stale or mistyped profile bed larger than the real work area passed every gate
// (bounds preflight tests the profile bed alone). This compares the profile's
// work area against the reported $130/$131 travel, and the fastest EMITTED feed
// — output-layer speeds AND object speed overrides — against the SLOWER reported
// axis rate ($110/$111), so an asymmetric machine or an object override above
// the slow axis is caught (Codex re-audit R4). Advisory, never a gate — an
// operator who knows their real area or accepts firmware clamping may proceed.
// Pure: the detected snapshot is passed in (the laser store owns it).

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import { sceneObjectUsesLayerColor, type Layer, type Project } from '../../core/scene';

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
  const axisLimit = reportedAxisFeedLimit(limits);
  if (axisLimit === null) return [];
  const topSpeed = maxOutputSpeed(project);
  if (topSpeed === null) return [];
  // Compare what the emitter actually WRITES — min(effective speed, profile
  // maxFeed) (compile-job.ts) — against the controller's reported rate.
  // Attributing the clamp to the controller is only correct once the app's own
  // profile clamp has been applied; otherwise a profile-capped speed would
  // falsely blame the controller (self-audit of DEV-06).
  const emittedFeed = Math.min(topSpeed, project.device.maxFeed);
  if (emittedFeed <= axisLimit) return [];
  return [
    `A layer's feed ${emittedFeed} mm/min is above the machine's reported max rate ` +
      `${axisLimit} mm/min — the controller clamps to its limit, so the job ` +
      'runs slower than planned.',
  ];
}

// The SLOWER of the two reported axis rates ($110/$111): a job at that feed is
// firmware-clamped on the slow axis even if the fast axis could keep up. Falls
// back to the collapsed maxFeed (the GREATER of the pair) only when per-axis
// rates aren't reported (Codex re-audit R4).
function reportedAxisFeedLimit(limits: ControllerSettingsSnapshot): number | null {
  const axisRates = [limits.maxFeedX, limits.maxFeedY].filter(
    (rate): rate is number => rate !== undefined,
  );
  if (axisRates.length > 0) return Math.min(...axisRates);
  return limits.maxFeed ?? null;
}

// The fastest speed the job actually emits: output-layer base speeds AND any
// per-object speed override on an output layer (the compiler applies the
// override before capping to device.maxFeed, so a layer-only scan misses it —
// Codex re-audit R4). Null when nothing outputs.
function maxOutputSpeed(project: Project): number | null {
  const outputLayers = project.scene.layers.filter((layer) => layer.output);
  const speeds = [
    ...outputLayers.map((layer) => layer.speed),
    ...objectOverrideSpeedsOnOutputLayers(project, outputLayers),
  ];
  return speeds.length === 0 ? null : Math.max(...speeds);
}

function objectOverrideSpeedsOnOutputLayers(
  project: Project,
  outputLayers: ReadonlyArray<Layer>,
): number[] {
  const speeds: number[] = [];
  for (const object of project.scene.objects) {
    const override = object.operationOverride?.speed;
    if (override === undefined) continue;
    if (outputLayers.some((layer) => sceneObjectUsesLayerColor(object, layer.color))) {
      speeds.push(override);
    }
  }
  return speeds;
}
