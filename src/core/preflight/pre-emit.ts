// pre-emit — cheap, project-level preflight that runs BEFORE compileJob.
// Since ADR-241/ADR-243 removed the complexity and raster-size refusals
// (vector/fill scenes of any size compile, and rasters of any size stream
// row-by-row), the only issues left here are configuration facts that make
// the travel policy unusable and non-finite scan offsets. Size and duration
// concerns surface as Job Review advisories instead (start-job-readiness).
// This boundary also reports exact configuration facts that make honest
// compilation impossible, such as a contributing V-carve whose V-bit has no
// valid included angle.
// Pure-core: no clock, no random, no I/O.

import type { Project } from '../scene';
import type { PreflightIssue, PreflightResult } from './preflight';
import { findInvalidCncToolGeometry } from './cnc-tool-geometry';
import { controlledLaserOffTravelFeedIssue } from './laser-off-motion-policy';
import { operationScanOffsetIssues } from './scan-offset-policy';

export function runPreEmitPreflight(project: Project): PreflightResult {
  const issues: PreflightIssue[] = [];
  if (project.machine?.kind === 'cnc') {
    issues.push(...findInvalidCncToolGeometry(project.scene, project.machine, project.device));
  }
  const controlledFeed = project.device.controlledLaserOffTravelFeedMmPerMin;
  const controlledTravelIssue = controlledLaserOffTravelFeedIssue(project.device);
  if (
    controlledFeed !== undefined &&
    (!Number.isFinite(controlledFeed) || controlledFeed <= 0) &&
    controlledTravelIssue !== null
  ) {
    issues.push({ code: 'speed-out-of-range', message: controlledTravelIssue });
  }
  issues.push(...operationScanOffsetIssues(project, { nonFiniteOnly: true }));
  return { ok: issues.length === 0, issues };
}
