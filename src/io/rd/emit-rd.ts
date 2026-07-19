// emitRdFile — the Ruida twin of emitGcode: runs the SAME prepareOutput
// pipeline (preview = save, ADR-040), then encodes the .rd byte stream.

import { encodeRdJob, type RdEncodeError } from '../../core/controllers/ruida';
import { machineSpaceJob, type JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import { prepareOutput } from '../gcode';

export type EmitRdOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
};

export type EmitRdResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export function emitRdFile(project: Project, options: EmitRdOptions = {}): EmitRdResult {
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  });
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  // Ruida export is the twin of emitGcode: apply the same rotary machine-space
  // scaling so a saved .rd matches the streamed G-code (identity for
  // non-rotary; rotary raster is refused by the encoder below) — review R3.
  const machineJob = machineSpaceJob(
    prepared.job,
    prepared.project.device,
    prepared.project.machine,
  );
  const encoded = encodeRdJob(machineJob, prepared.project.device);
  if (!encoded.ok) return { ok: false, messages: [describeRdEncodeError(encoded.error)] };
  return { ok: true, bytes: encoded.bytes };
}

function describeRdEncodeError(error: RdEncodeError): string {
  switch (error.kind) {
    case 'empty-job':
      return 'Nothing to export — enable Output on at least one layer with geometry.';
    case 'raster-unsupported':
      return `Layer ${error.layerId} uses Fill/Image raster output, which the experimental .rd encoder does not support yet. Use Line mode layers for Ruida export.`;
    case 'too-many-layers':
      return `The job has ${error.count} layers; Ruida files support at most 100.`;
  }
}
