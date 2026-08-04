import { sanitizeGcodeCommentValue } from '../gcode-comments';
import type { CncGroup, CncPath3dPass } from '../job';
import { cncGroupMaximumDepthMm } from '../job/job';
import { fmt, fmtFeed } from './cnc-grbl-emit-head';

const LABEL_BYTES = 48;
const NUMBER_BYTES = 12;

/** Append short, inert lines that preserve the settings needed for diagnosis. */
export function appendCncGroupComments(lines: string[], group: CncGroup): void {
  lines.push(`; cnc layer-id: ${label(group.layerId)}`);
  lines.push(`; cnc operation: ${group.cutType}; passes: ${group.passes.length}`);
  if (group.toolId !== undefined) lines.push(`; cnc tool-id: ${label(group.toolId)}`);
  if (group.toolName !== undefined) lines.push(`; cnc tool-name: ${label(group.toolName)}`);
  lines.push(toolGeometryComment(group));
  if (group.toolFluteCount !== undefined) {
    lines.push(`; cnc tool-flutes: ${shortNumber(group.toolFluteCount)}`);
  }
  if (
    group.layerPrimaryToolId !== undefined &&
    group.toolId !== undefined &&
    group.layerPrimaryToolId !== group.toolId
  ) {
    lines.push(`; cnc layer-primary-tool-id: ${label(group.layerPrimaryToolId)}`);
  }
  const depth = depthComment(group);
  if (depth !== null) lines.push(depth);
  if (group.vResolutionMm !== undefined) {
    const resolution = group.vResolutionMm === 0 ? 'auto' : fmt(group.vResolutionMm);
    lines.push(`; cnc v-resolution-mm: ${resolution}`);
  }
  appendVCarveComments(lines, group);
  appendEntryComments(lines, group);
  lines.push(
    `; cnc motion: feed-mm-min: ${fmtFeed(group.feedMmPerMin)}; ` +
      `plunge-mm-min: ${fmtFeed(group.plungeMmPerMin)}`,
  );
  lines.push(`; cnc spindle-rpm: ${Math.max(0, Math.round(group.spindleRpm))}`);
  appendFeedSourceComments(lines, group);
}

function appendVCarveComments(lines: string[], group: CncGroup): void {
  if (group.cutType !== 'v-carve') return;
  if (group.vCarveFlatDepthEnabled !== undefined) {
    lines.push(
      `; cnc v-carve-depth: ${group.vCarveFlatDepthEnabled ? 'flat-floor' : 'flowing-width'}`,
    );
  }
  lines.push(`; cnc v-carve-actual-max-depth-mm: ${fmt(cncGroupMaximumDepthMm(group))}`);
}

function appendEntryComments(lines: string[], group: CncGroup): void {
  if (group.rampEntryDeg === undefined) return;
  const entryPaths = group.passes.filter(
    (pass): pass is CncPath3dPass => pass.kind === 'path3d' && pass.entryRamp === true,
  );
  const strategy =
    group.cutType === 'v-carve' && entryPaths.length === 0 ? 'medial-profile' : 'contour-ramp';
  const angleLabel = group.rampEntryTiled ? 'requested-max-angle-deg' : 'max-angle-deg';
  lines.push(`; cnc entry: ${strategy}; ${angleLabel}: ${fmt(group.rampEntryDeg)}`);
  if (strategy === 'medial-profile') {
    lines.push(
      '; cnc entry-advisory: requested max angle is not applied to the variable-depth path',
    );
  }
  if (group.rampEntryTiled) {
    lines.push('; cnc entry-advisory: tiled output does not retain the max-angle guarantee');
  }
  if (entryPaths.some((pass) => (pass.points[0]?.z ?? 0) < 0)) {
    lines.push('; cnc entry-advisory: tiled ramp starts below stock top');
  }
  // A v-carve layer can ramp its constant-depth ring ladder while its
  // variable-depth thin-detail passes keep stepped entry (ADR-282 Amendment 5).
  // Without this line the strategy above would claim the whole layer ramped.
  if (entryPaths.length > 0 && hasSteppedDetail(group)) {
    lines.push('; cnc entry-advisory: thin-detail passes use stepped entry');
  }
}

function hasSteppedDetail(group: CncGroup): boolean {
  return group.passes.some((pass) => pass.kind === 'path3d' && pass.entryRamp !== true);
}

function toolGeometryComment(group: CncGroup): string {
  const kind = group.toolKind === undefined ? '' : `${group.toolKind}; `;
  const angle =
    group.toolTipAngleDeg === undefined ? '' : `; angle-deg: ${fmt(group.toolTipAngleDeg)}`;
  const tipDiameter =
    group.toolTipDiameterMm === undefined
      ? ''
      : `; tip-diameter-mm: ${fmt(group.toolTipDiameterMm)}`;
  return `; cnc tool: ${kind}diameter-mm: ${fmt(group.toolDiameterMm)}${angle}${tipDiameter}`;
}

function depthComment(group: CncGroup): string | null {
  const values: string[] = [];
  if (group.requestedDepthMm !== undefined) {
    values.push(`requested-mm: ${fmt(group.requestedDepthMm)}`);
  }
  if (group.depthPerPassMm !== undefined) {
    values.push(`per-pass-mm: ${fmt(group.depthPerPassMm)}`);
  }
  return values.length === 0 ? null : `; cnc depth: ${values.join('; ')}`;
}

function appendFeedSourceComments(lines: string[], group: CncGroup): void {
  const source = group.feedSource;
  if (source === undefined) {
    lines.push('; cnc feed-source: manual');
    return;
  }
  lines.push(`; cnc feed-source: ${source.kind}`);
  if (source.kind === 'machine-starter') {
    lines.push(
      `; cnc starter-id: ${label(source.starterId)}; revision: ${shortNumber(source.revision)}`,
    );
    return;
  }
  lines.push(
    `; cnc material-key: ${label(source.materialKey)}; ` +
      `flute-count: ${shortNumber(source.fluteCount)}`,
  );
}

function label(value: string): string {
  return sanitizeGcodeCommentValue(value, LABEL_BYTES) || '(blank)';
}

function shortNumber(value: number): string {
  return sanitizeGcodeCommentValue(String(Math.round(value)), NUMBER_BYTES);
}
