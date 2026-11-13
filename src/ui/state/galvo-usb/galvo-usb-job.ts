// Compiles the project into the job the galvo USB link runs (ADR-704): the
// LMC program from the same prepareOutput pipeline as every other output
// (preview = output), and the red-light Frame of its footprint. It compiles
// from the shared link request, as the Moshi, K40 and Ruida routes do: the
// placement, the output scope ("Selected artwork only"), the shared job
// warnings and the "After completed job" variable advance (ADR-705
// Amendments 4 and 7).

import { encodeLmcFrameJob } from '../../../core/controllers/jcz/lmc-frame-job';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { emitPreparedLmcProgram, lmcPreparationOptions } from '../../../io/lmc/emit-lmc';
import { sharedJobWarnings } from '../../laser/shared-job-warnings';
import { outputTextRenderer } from '../../text/output-text-renderer';
import { linkJobOutcome } from '../link-job-outcome';
import type { LinkJobRequest } from '../link-job-request';
import type { GalvoUsbJob } from './galvo-usb-store';

export const GALVO_ABSOLUTE_ONLY =
  'A galvo marks the artwork where it sits in the lens field. Choose Absolute Coordinates placement; User Origin, Verified Origin and Current Position are not built for a galvo.';

const GALVO_RED_LIGHT_SPEED = 'The red-light speed cannot be sent to the board at this lens size.';

export type GalvoUsbJobResult =
  | { readonly ok: true; readonly job: GalvoUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareGalvoUsbJob(request: LinkJobRequest): Promise<GalvoUsbJobResult> {
  const { project, placement, outputScope } = request;
  if (placement.startFrom !== 'absolute') return { ok: false, messages: [GALVO_ABSOLUTE_ONLY] };
  const checked = await withTextGlyphCheck(
    prepareOutput(project, lmcPreparationOptions({ outputScope })),
    project,
    outputTextRenderer,
  );
  const result = emitPreparedLmcProgram(checked);
  if (!result.ok || !checked.ok) return { ok: false, messages: result.ok ? [] : result.messages };
  const setup = project.device.galvo;
  const frame =
    setup === undefined
      ? null
      : encodeLmcFrameJob(result.program.footprint, setup, project.device.bedWidth);
  if (frame === null) return { ok: false, messages: [GALVO_RED_LIGHT_SPEED] };
  return {
    ok: true,
    job: {
      program: result.program,
      frame,
      ...linkJobOutcome(
        request,
        result.advisories.map((issue) => issue.message),
        sharedJobWarnings(checked),
      ),
    },
  };
}
