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

export type GcodeMetadata = {
  readonly appName: string;
  readonly appVersion: string;
  readonly gitSha: string;
  readonly buildTimeUtc: string;
  readonly emitterRevision: string;
};

// Bump when the emitter's G-code-shaping behavior changes. Currently covers the
// continuous-sweep fill (ADR-034), the >5 mm fill gap-rapid split (ADR-035), M4
// dynamic power for fill (ADR-036), raster gap-rapid splitting (ADR-039), and
// standalone surfacing safe-Z-before-M3 ordering (ADR-103), ADR-234's bounded
// 4040 Fill entry geometry, and ADR-235's controlled seeks/scan-quality policy.
export const EMITTER_REVISION = 'adr-235-4040-quality-controlled-v2';

// Machine-specific assumption lines (ADR-103 defect fix): router exports
// previously carried the laser-worded `$32=1 (laser mode)` banner. The S
// scale meaning differs per machine — laser: $30 = max beam power S; CNC:
// $30 = spindle max RPM so `S<rpm>` maps 1:1 — and $32 must be 1 on a laser
// but 0 on a router (laser mode alters M3 during rapids).
export type GcodeHeaderAssumptions =
  | { readonly kind: 'laser'; readonly maxPowerS: number }
  | { readonly kind: 'cnc'; readonly spindleMaxRpm: number };

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
): string {
  const safe = {
    appName: sanitizeMetadataCommentValue(metadata.appName),
    appVersion: sanitizeMetadataCommentValue(metadata.appVersion),
    gitSha: sanitizeMetadataCommentValue(metadata.gitSha),
    buildTimeUtc: sanitizeMetadataCommentValue(metadata.buildTimeUtc),
    emitterRevision: sanitizeMetadataCommentValue(metadata.emitterRevision),
  };
  return [
    `; ${safe.appName}`,
    `; version: ${safe.appVersion}`,
    `; commit: ${safe.gitSha}`,
    `; built: ${safe.buildTimeUtc}`,
    `; emitter: ${safe.emitterRevision}`,
    ...assumptionLines(assumed),
    '',
  ].join('\n');
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
    '; safety: laser-off travel is explicit S0; ordinary split-fill entry <=5mm; fill+raster dynamic power (M4)',
  ];
}

function sanitizeMetadataCommentValue(value: string): string {
  return Array.from(value, (char) => (isMetadataLineBreakOrControl(char) ? ' ' : char))
    .join('')
    .trim();
}

function isMetadataLineBreakOrControl(value: string): boolean {
  const code = value.charCodeAt(0);
  return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
}
