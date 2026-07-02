import { describe, expect, it } from 'vitest';
import { EMITTER_REVISION, gcodeMetadataHeader, type GcodeMetadata } from './gcode-metadata';

const META: GcodeMetadata = {
  appName: 'KerfDesk',
  appVersion: '0.0.0',
  gitSha: 'abc1234',
  buildTimeUtc: '2026-06-03T12:00:00.000Z',
  emitterRevision: EMITTER_REVISION,
};

describe('gcodeMetadataHeader', () => {
  it('tracks the ADR-039 raster gap-rapid emitter revision', () => {
    expect(EMITTER_REVISION).toBe('adr-039-raster-gap-rapid-v1');
  });

  it('emits provenance as GRBL comment lines and ends with a newline', () => {
    const header = gcodeMetadataHeader(META, { kind: 'laser', maxPowerS: 1000 });
    expect(header).toContain('; KerfDesk');
    expect(header).toContain('; version: 0.0.0');
    expect(header).toContain('; commit: abc1234');
    expect(header).toContain('; built: 2026-06-03T12:00:00.000Z');
    expect(header).toContain(`; emitter: ${EMITTER_REVISION}`);
    // Every header line is a comment (so the controller ignores it)...
    for (const line of header.split('\n').filter((l) => l.length > 0)) {
      expect(line.startsWith(';')).toBe(true);
    }
    // ...and it terminates with a newline so the motion body follows cleanly.
    expect(header.endsWith('\n')).toBe(true);
  });

  // M11 (AUDIT-2026-06-10): a file emitted for $30=1000 but run on a $30=255
  // controller clamps every S>255 to 100% beam power. The header must record
  // the assumed $30 so the mismatch is auditable from the file alone.
  it('records the assumed $30 power scale and laser mode', () => {
    const header = gcodeMetadataHeader(META, { kind: 'laser', maxPowerS: 255 });
    expect(header).toContain('; assumes: GRBL $30=255 (max S), $32=1 (laser mode)');
  });

  // ADR-102 defect fix: router exports carried the laser-worded banner. The
  // CNC header names the RPM mapping and router mode instead.
  it('records router-mode assumptions for CNC exports', () => {
    const header = gcodeMetadataHeader(META, { kind: 'cnc', spindleMaxRpm: 24000 });
    expect(header).toContain(
      '; assumes: GRBL $30=24000 (S maps 1:1 to spindle RPM), $32=0 (router mode)',
    );
    expect(header).toContain('; safety: retract to safe Z before travels');
    expect(header).not.toContain('laser mode');
  });
});
