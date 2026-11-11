// Compiles the project into the job the Lihuiyu USB link sends (ADR-703): the
// same stream Save .egv writes (emitPreparedEgvFile, preview = save) and the
// footprint the Frame traces and Start checks. An Absolute job starts from the
// head's known position (machine coordinates from Home); an origin-relative
// job starts from its own zero, wherever the head stands.

import { lhyBoardSetting } from '../../../core/controllers/lihuiyu/lhy-encoder';
import type { LhyPoint } from '../../../core/controllers/lihuiyu/lhy-motion-plan';
import type { JobPlacementSettings } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { egvPreparationOptions, emitPreparedEgvFile, type EmitEgvOptions } from '../../../io/egv';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { resolveExportJobPlacement } from '../../job-placement';
import { outputTextRenderer } from '../../text/output-text-renderer';
import { LIHUIYU_HOME_FIRST } from './lihuiyu-usb-messages';
import type { LihuiyuUsbJob } from './lihuiyu-usb-types';

export const LIHUIYU_CURRENT_POSITION_UNSUPPORTED =
  'Current Position needs a live position report, which a Lihuiyu board does not give. Choose User Origin to run the job from where the head stands, or Absolute after Home.';

export type LihuiyuUsbJobResult =
  | { readonly ok: true; readonly job: LihuiyuUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareLihuiyuUsbJob(
  project: Project,
  placement: JobPlacementSettings,
  head: LhyPoint | null,
): Promise<LihuiyuUsbJobResult> {
  if (placement.startFrom === 'current-position')
    return { ok: false, messages: [LIHUIYU_CURRENT_POSITION_UNSUPPORTED] };
  const absolute = placement.startFrom === 'absolute';
  if (absolute && head === null) return { ok: false, messages: [LIHUIYU_HOME_FIRST] };
  // No live machine state exists for a Lihuiyu board: placement is the
  // export placement, relative to where the head stands.
  const resolved = resolveExportJobPlacement(placement, { statusReport: null });
  if (!resolved.ok) return { ok: false, messages: resolved.messages };
  const options: EmitEgvOptions = {
    ...(resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin }),
    ...(resolved.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: resolved.preflightMotionOffset }),
    ...(absolute && head !== null ? { start: head } : {}),
  };
  const prepared = prepareOutput(project, egvPreparationOptions(options));
  const result = emitPreparedEgvFile(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
    options,
  );
  if (!result.ok) return { ok: false, messages: result.messages };
  return {
    ok: true,
    job: {
      stream: result.stream,
      footprint: result.footprint,
      absolute,
      board: lhyBoardSetting(project.device.lihuiyuBoard),
      framingMmPerMin: project.device.framingFeedMmPerMin,
      advisories: result.advisories.map((issue) => issue.message),
    },
  };
}
