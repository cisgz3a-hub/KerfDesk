// Shared wrapper for standalone CNC generators. The generator supplies a
// deterministic motion body; this seam adds the same provenance contract as a
// normal export and runs the standalone final-text preflight before UI I/O.

import { runStandaloneCncPreflight, type PreflightResult } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { gcodeMetadataHeader, type GcodeMetadata } from './gcode-metadata';

export type EmitStandaloneCncGcodeResult = {
  readonly gcode: string;
  readonly preflight: PreflightResult;
};

export function emitStandaloneCncGcode(
  project: Project,
  body: string,
  metadata?: GcodeMetadata,
): EmitStandaloneCncGcodeResult {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') {
    return {
      gcode: '',
      preflight: {
        ok: false,
        issues: [
          {
            code: 'cnc-settings-invalid',
            message: 'Standalone CNC output requires an active CNC machine configuration.',
          },
        ],
      },
    };
  }
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  const preflight = runStandaloneCncPreflight(project.device, machine, normalizedBody);
  const gcode =
    metadata === undefined
      ? normalizedBody
      : gcodeMetadataHeader(metadata, {
          kind: 'cnc',
          spindleMaxRpm: machine.params.spindleMaxRpm,
        }) + normalizedBody;
  return { gcode, preflight };
}
