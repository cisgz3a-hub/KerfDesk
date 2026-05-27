// emitGcode — runs the Phase A pipeline (compile → emit → preflight) over a
// Project and returns the G-code string plus the preflight verdict. Pure: no
// I/O. The UI / platform adapter decides whether to actually write the file
// based on `preflight.ok`.

import { runPreflight, type PreflightResult } from '../../core/preflight';
import { compileJob, optimizePaths } from '../../core/job';
import { grblStrategy } from '../../core/output';
import type { Project } from '../../core/scene';

export type EmitGcodeResult = {
  readonly gcode: string;
  readonly preflight: PreflightResult;
};

export function emitGcode(project: Project): EmitGcodeResult {
  // compile → optimize → emit. The optimize step is pure path-order
  // reduction (nearest-neighbor heuristic) — same cuts, same speeds,
  // same passes, just shorter travel between them. Determinism
  // preserved (PROJECT.md non-negotiable #5).
  const job = optimizePaths(compileJob(project.scene, project.device));
  const gcode = grblStrategy.emit(job, project.device);
  const preflight = runPreflight(project, gcode);
  return { gcode, preflight };
}
