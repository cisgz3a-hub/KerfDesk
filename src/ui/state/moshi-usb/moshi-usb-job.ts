// Compiles the project into the job the Moshi USB link sends (ADR-705): the
// same prepareOutput pipeline every output runs (preview = output), encoded
// as Moshi programs, and the footprint the Frame traces and Start checks.

import type { JobPlacementSettings } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { emitPreparedMoshiJob } from '../../../io/moshi';
import { outputTextRenderer } from '../../text/output-text-renderer';
import type { MoshiUsbJob } from './moshi-usb-types';

export const MOSHI_ABSOLUTE_ONLY =
  'A Moshiboard runs every job from its home corner and does not report where its head is. Set Start From to Absolute Coords.';

export type MoshiUsbJobResult =
  | { readonly ok: true; readonly job: MoshiUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareMoshiUsbJob(
  project: Project,
  placement: JobPlacementSettings,
): Promise<MoshiUsbJobResult> {
  if (placement.startFrom !== 'absolute') return { ok: false, messages: [MOSHI_ABSOLUTE_ONLY] };
  const prepared = prepareOutput(project, {});
  const result = emitPreparedMoshiJob(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
  );
  if (!result.ok) return { ok: false, messages: result.messages };
  return {
    ok: true,
    job: {
      programs: result.programs.map((program) => program.bytes),
      footprint: result.footprint,
      advisories: result.advisories,
      framingFeedMmPerMin: project.device.framingFeedMmPerMin,
    },
  };
}
