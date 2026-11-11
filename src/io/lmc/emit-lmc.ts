// emitLmcProgram — the galvo twin of emitRdFile (ADR-704): the SAME
// prepareOutput pipeline (preview = output, ADR-040), the same machine-space
// job, then the LMC list encoder. A galvo has no job file, so this feeds only
// the USB link's Start; its advisories are warnings, never refusals.

import {
  encodeLmcJob,
  type LmcEncodeError,
  type LmcProgram,
} from '../../core/controllers/jcz/lmc-encoder';
import { machineSpaceJob, type JobOriginPlacement } from '../../core/job';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import type { PreflightIssue } from '../../core/preflight';
import type { OutputScope } from '../../core/scene';
import type { PreparedOutput, PrepareOutputOptions } from '../gcode';

export type EmitLmcOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
};

export type EmitLmcResult =
  | {
      readonly ok: true;
      readonly program: LmcProgram;
      readonly advisories: ReadonlyArray<PreflightIssue>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

/** What a galvo program compiles with: its placement and scope. */
export function lmcPreparationOptions(options: EmitLmcOptions): PrepareOutputOptions {
  return {
    ...(options.jobOrigin ? { jobOrigin: options.jobOrigin } : {}),
    ...(options.outputScope ? { outputScope: options.outputScope } : {}),
  };
}

/** Encodes an output prepared with lmcPreparationOptions(options). */
export function emitPreparedLmcProgram(prepared: PreparedOutput): EmitLmcResult {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const { project } = prepared;
  if (project.machine?.kind === 'cnc')
    return {
      ok: false,
      messages: [describeLmcEncodeError({ kind: 'cnc-unsupported', layerId: '' })],
    };
  if (rotaryAppliesTo(project.device, project.machine))
    return { ok: false, messages: [LMC_ROTARY_UNSUPPORTED] };
  const job = machineSpaceJob(prepared.job, project.device, project.machine);
  const encoded = encodeLmcJob(job, project.device, { layers: project.scene.layers });
  if (!encoded.ok) return { ok: false, messages: [describeLmcEncodeError(encoded.error)] };
  return { ok: true, program: encoded.program, advisories: prepared.advisories ?? [] };
}

export const LMC_ROTARY_UNSUPPORTED =
  'A rotary is not built for a JCZ galvo in this build. Turn the rotary off in Machine Setup to mark a flat job.';

export function describeLmcEncodeError(error: LmcEncodeError): string {
  switch (error.kind) {
    case 'empty-job':
      return 'Nothing to mark — enable Output on at least one Line or Fill layer with geometry.';
    case 'galvo-setup-missing':
      return 'This galvo machine has no lens and source setup. Choose a JCZ galvo profile in Machine Setup.';
    case 'field-not-square':
      return `A galvo's bed is its square lens field, but this machine is ${error.widthMm} × ${error.heightMm} mm. Set the bed width and height to the lens field size.`;
    case 'raster-unsupported':
      return `Layer ${error.layerId} is an Image raster, which the experimental galvo encoder does not mark yet. Use Line or Fill layers.`;
    case 'cnc-unsupported':
      return 'A CNC router job cannot run on a galvo laser. Switch the project to Laser mode.';
    case 'outside-field':
      return `Layer ${error.layerId} reaches X ${error.point.x.toFixed(2)} Y ${error.point.y.toFixed(2)} mm, outside the lens field. Move the artwork inside the field.`;
    case 'speed-out-of-range':
      return error.travel
        ? `The galvo jump speed (${error.mmPerSec} mm/s) cannot be sent to the board at this lens size.`
        : `Layer ${error.layerId} speed (${error.mmPerSec.toFixed(1)} mm/s) cannot be sent to the board at this lens size.`;
  }
}
