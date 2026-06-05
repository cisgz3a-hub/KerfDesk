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
  readonly appName: 'LaserForge 2.0';
  readonly appVersion: string;
  readonly gitSha: string;
  readonly buildTimeUtc: string;
  readonly emitterRevision: string;
};

// Bump when the emitter's G-code-shaping behavior changes. Currently covers the
// continuous-sweep fill (ADR-034), the >5 mm gap-rapid split (ADR-035), and M4
// dynamic power for fill (ADR-036).
export const EMITTER_REVISION = 'adr-036-m4-fill-v1';

// Leading `;` comment lines; GRBL ignores them. Ends with a trailing newline so
// the motion body starts cleanly on its own line when concatenated.
export function gcodeMetadataHeader(metadata: GcodeMetadata): string {
  return [
    `; ${metadata.appName}`,
    `; version: ${metadata.appVersion}`,
    `; commit: ${metadata.gitSha}`,
    `; built: ${metadata.buildTimeUtc}`,
    `; emitter: ${metadata.emitterRevision}`,
    '; safety: G0 carries S0; blank gaps >5mm rapid (G0); fill+raster dynamic power (M4)',
    '',
  ].join('\n');
}
