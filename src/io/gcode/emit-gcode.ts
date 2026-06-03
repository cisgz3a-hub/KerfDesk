// emitGcode — runs the Phase A pipeline (compile → emit → preflight) over a
// Project and returns the G-code string plus the preflight verdict. Pure: no
// I/O. The UI / platform adapter decides whether to actually write the file
// based on `preflight.ok`.

import {
  runPreEmitPreflight,
  runPreflight,
  type PreflightOptions,
  type PreflightResult,
} from '../../core/preflight';
import { applyJobOrigin, compileJob, optimizePaths, type JobOriginPlacement } from '../../core/job';
import { grblStrategy } from '../../core/output';
import type { Project } from '../../core/scene';
import { gcodeMetadataHeader, type GcodeMetadata } from './gcode-metadata';

export type EmitGcodeResult = {
  readonly gcode: string;
  readonly preflight: PreflightResult;
};

export type EmitGcodeOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  // When set, a provenance comment header (build/commit/emitter) is prepended to
  // the returned G-code. Preflight runs on the motion body only, so the header
  // never affects the verdict, and callers that need deterministic, header-free
  // output (tests, preview) simply omit it.
  readonly metadata?: GcodeMetadata;
};

export function emitGcode(project: Project, options: EmitGcodeOptions = {}): EmitGcodeResult {
  // Pre-emit budget guard FIRST: a raster that would engrave to an enormous
  // pixel grid is refused here, before compileJob allocates the resampled luma,
  // the dither buffers, and the G-code string (roadmap P1-A). Empty g-code +
  // the failing preflight means the UI shows the reason instead of freezing.
  const preEmit = runPreEmitPreflight(project);
  if (!preEmit.ok) return { gcode: '', preflight: preEmit };

  // compile → optimize → emit. The optimize step is pure path-order
  // reduction (nearest-neighbor heuristic) — same cuts, same speeds,
  // same passes, just shorter travel between them. Determinism
  // preserved (PROJECT.md non-negotiable #5).
  const compiled = compileJob(project.scene, project.device);
  const placed = options.jobOrigin ? applyJobOrigin(compiled, options.jobOrigin) : compiled;
  const job = optimizePaths(placed);
  const body = grblStrategy.emit(job, project.device);
  // Preflight the motion body, NOT the header — the provenance comments are
  // inert to every invariant (all strip comments) but keeping them out of the
  // preflight input makes that guarantee explicit.
  const preflight = runPreflight(project, body, {
    motionOffset: options.preflightMotionOffset,
  });
  const gcode = options.metadata ? gcodeMetadataHeader(options.metadata) + body : body;
  return { gcode, preflight };
}
