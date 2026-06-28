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
// dynamic power for fill (ADR-036), and raster gap-rapid splitting (ADR-039).
export const EMITTER_REVISION = 'adr-039-raster-gap-rapid-v1';

// Leading `;` comment lines; GRBL ignores them. Ends with a trailing newline so
// the motion body starts cleanly on its own line when concatenated.
//
// `assumed.maxPowerS` records the GRBL $30 the S values were scaled against
// (M11, AUDIT-2026-06-10): a file emitted for $30=1000 but run on a $30=255
// controller clamps every S>255 to 100% beam power — the header makes the
// assumption auditable from the file alone (SD card / other senders).
export function gcodeMetadataHeader(
  metadata: GcodeMetadata,
  assumed: { readonly maxPowerS: number },
): string {
  return [
    `; ${metadata.appName}`,
    `; version: ${metadata.appVersion}`,
    `; commit: ${metadata.gitSha}`,
    `; built: ${metadata.buildTimeUtc}`,
    `; emitter: ${metadata.emitterRevision}`,
    `; assumes: GRBL $30=${assumed.maxPowerS} (max S), $32=1 (laser mode)`,
    '; safety: G0 carries S0; blank gaps >5mm rapid (G0); fill+raster dynamic power (M4)',
    '',
  ].join('\n');
}
