// The machine profile schema a rotary axis or taper needs (ADR-695, ADR-694).
// A reader from before them drops `rotary.axis` and would drive an A or Z
// rotary as Y, or drops `rotary.taper` and would burn a tapered part unwarped.
// So a profile with a dedicated axis or an active taper is written as schema 2,
// which that reader refuses as too new. Every other profile stays schema 1,
// readable by it.

import { activeRotaryTaper } from '../../core/devices/rotary';
import { dedicatedRotaryAxisOf } from '../../core/devices/rotary-axis';
import type { DeviceProfile } from '../../core/devices';

export const MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION = 2;

/** The document as written: schema 2 when its profile has a dedicated rotary
 * axis or an active taper. */
export function rotaryAxisSchema<T extends { readonly profile: Pick<DeviceProfile, 'rotary'> }>(
  document: T,
): T | (T & { readonly schemaVersion: number }) {
  const rotary = document.profile.rotary;
  const tapered = rotary !== undefined && activeRotaryTaper(rotary) !== null;
  return dedicatedRotaryAxisOf(rotary) === null && !tapered
    ? document
    : { ...document, schemaVersion: MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION };
}

/** True when a read schema version is newer than this build understands. */
export function schemaTooNew(version: number, base: number): boolean {
  return version > base && version !== MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION;
}
