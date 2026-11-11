// Compiles the project into the job the galvo USB link runs (ADR-704): the
// LMC program from the same prepareOutput pipeline as every other output
// (preview = output), and the red-light Frame of its footprint.

import { encodeLmcFrameJob } from '../../../core/controllers/jcz/lmc-frame-job';
import type { JobPlacementSettings } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { emitPreparedLmcProgram, lmcPreparationOptions } from '../../../io/lmc/emit-lmc';
import { outputTextRenderer } from '../../text/output-text-renderer';
import type { GalvoUsbJob } from './galvo-usb-store';

export const GALVO_ABSOLUTE_ONLY =
  'A galvo marks the artwork where it sits in the lens field. Choose Absolute Coordinates placement; User Origin, Verified Origin and Current Position are not built for a galvo.';

export type GalvoUsbJobResult =
  | { readonly ok: true; readonly job: GalvoUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareGalvoUsbJob(
  project: Project,
  placement: JobPlacementSettings,
): Promise<GalvoUsbJobResult> {
  if (placement.startFrom !== 'absolute') return { ok: false, messages: [GALVO_ABSOLUTE_ONLY] };
  const prepared = prepareOutput(project, lmcPreparationOptions({}));
  const result = emitPreparedLmcProgram(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
  );
  if (!result.ok) return { ok: false, messages: result.messages };
  const setup = project.device.galvo;
  const frame =
    setup === undefined
      ? null
      : encodeLmcFrameJob(result.program.footprint, setup, project.device.bedWidth);
  if (frame === null)
    return {
      ok: false,
      messages: ['The red-light speed cannot be sent to the board at this lens size.'],
    };
  return {
    ok: true,
    job: {
      program: result.program,
      frame,
      advisories: result.advisories.map((issue) => issue.message),
    },
  };
}
