// gcode-metadata — optional provenance header prepended to EXPORTED G-code so a
// saved file records which build + emitter produced it. A stale export that
// predates a safety fix (e.g. ADR-035's gap-rapid split) is then obvious at a
// glance, and a controller transcript can be matched back to a source build.
//
// Pure io: takes data in, returns a string. It does NOT read build globals
// (__GIT_SHA__ etc.) — those live behind the UI boundary
// (src/ui/app/build-info.ts), which assembles the GcodeMetadata and passes it
// in. EMITTER_REVISION is a code constant HERE because it describes this
// emitter's behavior, not the build environment.

import type { DeviceProfile } from '../../core/devices';
import { sanitizeGcodeCommentValue } from '../../core/gcode-comments';

export type GcodeMetadata = {
  readonly appName: string;
  readonly appVersion: string;
  readonly gitSha: string;
  readonly buildTimeUtc: string;
  readonly emitterRevision: string;
};

/**
 * Bump when the emitter's G-code-shaping behavior changes. Currently covers the
 * continuous-sweep fill (ADR-034), the >5 mm fill gap-rapid split (ADR-035), M4
 * dynamic power for fill (ADR-036), raster gap-rapid splitting (ADR-039), and
 * standalone surfacing safe-Z-before-M3 ordering (ADR-103), ADR-234's bounded
 * 4040 Fill entry geometry, ADR-236's controlled seeks/scan-quality policy,
 * ADR-238's generic Scan Line entry/exit runway geometry, ADR-270's
 * region-major V-carve traversal, and ADR-273's incident-grade CNC provenance.
 */
export const EMITTER_REVISION = 'adr-278-vcarve-contour-ramp-v1';

// Machine-specific assumption lines (ADR-103 defect fix): router exports
// previously carried the laser-worded `$32=1 (laser mode)` banner. The S
// scale meaning differs per machine — laser: $30 = max beam power S; CNC:
// $30 = spindle max RPM so `S<rpm>` maps 1:1 — and $32 must be 1 on a laser
// but 0 on a router (laser mode alters M3 during rapids).
export type GcodeHeaderAssumptions =
  | { readonly kind: 'laser'; readonly maxPowerS: number }
  | { readonly kind: 'cnc'; readonly spindleMaxRpm: number };

export type GcodeProfileIdentity = Pick<
  DeviceProfile,
  'name' | 'profileId' | 'profileSource' | 'catalogVersion'
>;

// Leading `;` comment lines; GRBL ignores them. Ends with a trailing newline so
// the motion body starts cleanly on its own line when concatenated.
//
// The laser `maxPowerS` line records the GRBL $30 the S values were scaled
// against (M11, AUDIT-2026-06-10): a file emitted for $30=1000 but run on a
// $30=255 controller clamps every S>255 to 100% beam power — the header makes
// the assumption auditable from the file alone (SD card / other senders).
export function gcodeMetadataHeader(
  metadata: GcodeMetadata,
  assumed: GcodeHeaderAssumptions,
  profile?: GcodeProfileIdentity,
): string {
  const safe = {
    appName: sanitizeGcodeCommentValue(metadata.appName),
    appVersion: sanitizeGcodeCommentValue(metadata.appVersion),
    gitSha: sanitizeGcodeCommentValue(metadata.gitSha),
    buildTimeUtc: sanitizeGcodeCommentValue(metadata.buildTimeUtc),
    emitterRevision: sanitizeGcodeCommentValue(metadata.emitterRevision),
  };
  return [
    `; ${safe.appName}`,
    `; version: ${safe.appVersion}`,
    `; commit: ${safe.gitSha}`,
    `; built: ${safe.buildTimeUtc}`,
    `; emitter: ${safe.emitterRevision}`,
    ...profileLines(profile),
    ...assumptionLines(assumed),
    '',
  ].join('\n');
}

function profileLines(profile: GcodeProfileIdentity | undefined): ReadonlyArray<string> {
  if (profile === undefined) return [];
  return [
    `; profile-name: ${profileValue(profile.name)}`,
    ...(profile.profileId === undefined
      ? []
      : [`; profile-id: ${profileValue(profile.profileId)}`]),
    ...(profile.profileSource === undefined
      ? []
      : [`; profile-source: ${profileValue(profile.profileSource)}`]),
    ...(profile.catalogVersion === undefined
      ? []
      : [`; profile-catalog: ${profileValue(profile.catalogVersion)}`]),
  ];
}

function profileValue(value: string): string {
  return sanitizeGcodeCommentValue(value, 48) || '(blank)';
}

function assumptionLines(assumed: GcodeHeaderAssumptions): ReadonlyArray<string> {
  if (assumed.kind === 'cnc') {
    return [
      `; assumes: GRBL $30=${assumed.spindleMaxRpm} (S maps 1:1 to spindle RPM), $32=0 (router mode)`,
      '; safety: retract to safe Z before travels; spindle spin-up dwell before first plunge',
    ];
  }
  return [
    `; assumes: GRBL $30=${assumed.maxPowerS} (max S), $32=1 (laser mode)`,
    '; safety: laser-off travel is explicit S0; ordinary Scan Line runway <=5mm per side; fill+raster dynamic power (M4)',
  ];
}
