// Compiles the project into the job the Ruida network link sends (ADR-697):
// the same .rd bytes Save .rd writes (emitPreparedRdFile, preview = save), and
// the footprint the Frame traces and Start checks.

import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { rdPreparationOptions, type EmitRdOptions } from '../../../io/rd';
import { emitPreparedRdWithJobWarnings } from '../../laser/rd-job-warnings';
import type { LinkJobRequest } from '../link-job-request';
import { resolveExportJobPlacement } from '../../job-placement';
import { outputTextRenderer } from '../../text/output-text-renderer';
import type { RuidaNetworkJob } from './ruida-network-store';

export const RUIDA_CURRENT_POSITION_UNSUPPORTED =
  'Current Position needs the head position, which the Ruida network link does not read back in this build. Choose Absolute or User Origin placement, or save an .rd file.';

export type RuidaNetworkJobResult =
  | { readonly ok: true; readonly job: RuidaNetworkJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareRuidaNetworkJob(
  request: LinkJobRequest,
): Promise<RuidaNetworkJobResult> {
  const { project, placement, outputScope } = request;
  if (placement.startFrom === 'current-position')
    return { ok: false, messages: [RUIDA_CURRENT_POSITION_UNSUPPORTED] };
  // No live GRBL-style machine state exists for a Ruida: placement is the
  // export placement, which the controller resolves from its own origin.
  const resolved = resolveExportJobPlacement(placement, { statusReport: null });
  if (!resolved.ok) return { ok: false, messages: resolved.messages };
  const options: EmitRdOptions = {
    ...(resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin }),
    ...(resolved.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: resolved.preflightMotionOffset }),
    // The canvas output scope, as Save .rd compiles with (C2 D2-P1-1).
    outputScope,
  };
  const prepared = prepareOutput(project, rdPreparationOptions(options));
  const result = emitPreparedRdWithJobWarnings(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
    options,
  );
  if (!result.ok) return { ok: false, messages: result.messages };
  return {
    ok: true,
    job: {
      bytes: result.bytes,
      footprint: result.footprint,
      advisories: [
        ...result.advisories.map((issue) => issue.message),
        ...(result.jobWarnings ?? []),
      ],
      completed: request.completed,
    },
  };
}
