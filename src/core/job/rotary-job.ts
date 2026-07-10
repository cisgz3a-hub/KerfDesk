// rotary-job — the single source of truth for turning a surface-space job
// into the machine-space job the rotary actually runs (ADR-127; review R3).
//
// The Y scale + rebase MUST be applied by every consumer that reasons about
// MACHINE motion — emit (G-code + .rd), framing, the time estimate, and
// placement bounds — or they disagree with each other: the frame sweep
// wouldn't match the burn, the ETA would be off by the scale factor, etc.
// Only the on-canvas PREVIEW stays surface-true (that's what the operator
// designs against), so it deliberately does NOT call this.

import { isRotaryActive, rotaryYLimitMm, rotaryYScale, type DeviceProfile } from '../devices';
import type { MachineConfig } from '../scene';
import type { Job } from './job';
import { applyRotaryYScale } from './rotary-transform';

// True when this project should apply rotary machine-space scaling: a laser
// project (never CNC) with an active, sane rotary setup.
export function rotaryAppliesTo(
  device: DeviceProfile,
  machine: MachineConfig | undefined,
): boolean {
  const isCnc = machine !== undefined && machine.kind === 'cnc';
  return !isCnc && isRotaryActive(device.rotary);
}

// The machine-space job (Y scaled + rebased). Identity when rotary is
// inactive, so non-rotary callers are byte-identical.
export function machineSpaceJob(
  job: Job,
  device: DeviceProfile,
  machine: MachineConfig | undefined,
): Job {
  if (!rotaryAppliesTo(device, machine) || device.rotary === undefined) return job;
  return applyRotaryYScale(job, rotaryYScale(device.rotary), device.rotary.reverseAxis === true);
}

// Y wrap limit (one revolution) for bounds checks, or null when rotary is
// inactive (callers then use the flat bed height).
export function rotaryWrapLimitMm(
  device: DeviceProfile,
  machine: MachineConfig | undefined,
): number | null {
  if (!rotaryAppliesTo(device, machine) || device.rotary === undefined) return null;
  return rotaryYLimitMm(device.rotary);
}
