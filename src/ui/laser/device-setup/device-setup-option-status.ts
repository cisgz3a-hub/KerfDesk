// Pure one-line status summaries for the Options & calibration step. Each
// summary makes a group's state readable from its always-visible header row
// without opening the section (ADR-240).

import { profileSupportsCapability, type DeviceProfile } from '../../../core/devices';

export function noGoZoneStatus(profile: DeviceProfile): string {
  const zones = profile.noGoZones;
  if (zones.length === 0) return 'None configured';
  const enabled = zones.filter((zone) => zone.enabled).length;
  return `${zones.length} zone${zones.length === 1 ? '' : 's'} (${enabled} enabled)`;
}

export function zAxisStatus(profile: DeviceProfile): string {
  if (!profileSupportsCapability(profile, 'z-axis')) return 'No powered Z';
  const travel = profile.zTravelMm;
  if (travel === undefined || travel <= 0) return 'Powered Z — travel not set';
  return profile.zTravelConfirmed === true
    ? `Powered Z, ${travel} mm confirmed`
    : `Powered Z, ${travel} mm unconfirmed`;
}

export function plannerStatus(profile: DeviceProfile): string {
  const cut = formatScale(profile.estimateCutTimeScale ?? 1);
  const travel = formatScale(profile.estimateTravelTimeScale ?? 1);
  return (
    `Accel ${profile.accelMmPerSec2} mm/s² · ` +
    `junction ${profile.junctionDeviationMm} mm · time ${cut}/${travel}`
  );
}

export function scanOffsetStatus(profile: DeviceProfile): string {
  const points = profile.scanningOffsets.length;
  const seek = profile.controlledLaserOffTravelFeedMmPerMin;
  const seekText = seek === undefined ? '' : `, controlled seek ${seek} mm/min`;
  if (points === 0) return `Not calibrated${seekText}`;
  const pending = profile.scanOffsetCalibrationStatus === 'pending';
  const pointText = `${points} point${points === 1 ? '' : 's'}`;
  return `${pointText}${pending ? ', verification pending' : ''}${seekText}`;
}

export function autofocusStatus(profile: DeviceProfile): string {
  return profile.autofocusCommand.trim() === '' ? 'Not configured' : 'Configured';
}

export function rotaryStatus(profile: DeviceProfile): string {
  const rotary = profile.rotary;
  if (rotary === undefined || !rotary.enabled) return 'Off';
  const type = rotary.type === 'roller' ? 'Roller' : 'Chuck';
  return `${type}, Ø${rotary.objectDiameterMm} mm`;
}

export function cameraStatus(profile: DeviceProfile): string {
  if (profile.cameraProfile === undefined) return 'Not set up';
  if (profile.cameraCalibration === undefined) return 'Lens calibration pending';
  if (profile.cameraAlignment === undefined) return 'Bed alignment pending';
  return 'Aligned';
}

function formatScale(value: number): string {
  return `×${value.toFixed(2)}`;
}
