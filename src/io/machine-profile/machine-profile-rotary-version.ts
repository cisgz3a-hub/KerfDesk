// The machine profile schema a rotary axis needs (ADR-695). A reader from
// before ADR-695 drops `rotary.axis` and would drive an A or Z rotary as Y, so
// a profile with a dedicated axis is written as schema 2, which that reader
// refuses as too new. Every other profile stays schema 1, readable by it.

import { dedicatedRotaryAxisOf } from '../../core/devices/rotary-axis';
import type { DeviceProfile } from '../../core/devices';

export const MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION = 2;

/** The document as written: schema 2 when its profile has a dedicated rotary axis. */
export function rotaryAxisSchema<T extends { readonly profile: Pick<DeviceProfile, 'rotary'> }>(
  document: T,
): T | (T & { readonly schemaVersion: number }) {
  return dedicatedRotaryAxisOf(document.profile.rotary) === null
    ? document
    : { ...document, schemaVersion: MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION };
}

/** True when a read schema version is newer than this build understands. */
export function schemaTooNew(version: number, base: number): boolean {
  return version > base && version !== MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION;
}
