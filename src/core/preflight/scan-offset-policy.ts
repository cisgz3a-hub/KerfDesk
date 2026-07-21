import {
  isScanOffsetMagnitudeForProfile,
  scanOffsetMagnitudeLimitMm,
} from '../devices/scan-offset-profile';
import { outputOperationLayers, sceneObjectUsesOperation, type Project } from '../scene';
import type { PreflightIssue } from './preflight';

type ScanOffsetIssueOptions = {
  /** Pre-compile callers use this to reject only values no emitter can encode. */
  readonly nonFiniteOnly?: boolean;
};

export function operationScanOffsetIssues(
  project: Project,
  options: ScanOffsetIssueOptions = {},
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const outputLayers = project.scene.layers.flatMap(outputOperationLayers);
  for (const layer of outputLayers) {
    const issue = scanOffsetIssue(
      `Layer ${layer.id}`,
      layer.bidirectionalScanOffsetMm,
      project,
      options,
    );
    if (issue !== null) issues.push(issue);
  }
  for (const object of project.scene.objects) {
    if (!outputLayers.some((layer) => sceneObjectUsesOperation(object, layer))) continue;
    const issue = scanOffsetIssue(
      `Object ${object.id}`,
      object.operationOverride?.bidirectionalScanOffsetMm,
      project,
      options,
    );
    if (issue !== null) issues.push(issue);
  }
  return issues;
}

function scanOffsetIssue(
  owner: string,
  offset: number | undefined,
  project: Project,
  options: ScanOffsetIssueOptions,
): PreflightIssue | null {
  if (offset === undefined) return null;
  if (!Number.isFinite(offset)) {
    return {
      code: 'scan-offset-out-of-range',
      message: `${owner} bidirectional scan offset ${String(offset)} mm must be finite.`,
    };
  }
  if (options.nonFiniteOnly === true || isScanOffsetMagnitudeForProfile(offset, project.device)) {
    return null;
  }
  const limit = scanOffsetMagnitudeLimitMm(project.device);
  // Distinct advisory code (rule 7): a finite over-cap magnitude is a
  // heuristic finding — it must warn (Job Review, post-save toast), never
  // block. Only the non-finite case above is a hard validity failure.
  return {
    code: 'scan-offset-above-cap',
    message: `${owner} bidirectional scan offset ${String(offset)} mm exceeds the device limit of ±${limit} mm.`,
  };
}
