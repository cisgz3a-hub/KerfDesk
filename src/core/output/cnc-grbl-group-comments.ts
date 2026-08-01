import { sanitizeGcodeCommentValue } from '../gcode-comments';
import type { CncGroup } from '../job';
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
  const depth = depthComment(group);
  if (depth !== null) lines.push(depth);
  if (group.vResolutionMm !== undefined) {
    const resolution = group.vResolutionMm === 0 ? 'auto' : fmt(group.vResolutionMm);
    lines.push(`; cnc v-resolution-mm: ${resolution}`);
  }
  lines.push(
    `; cnc motion: feed-mm-min: ${fmtFeed(group.feedMmPerMin)}; ` +
      `plunge-mm-min: ${fmtFeed(group.plungeMmPerMin)}`,
  );
  lines.push(`; cnc spindle-rpm: ${Math.max(0, Math.round(group.spindleRpm))}`);
  appendFeedSourceComments(lines, group);
}

function toolGeometryComment(group: CncGroup): string {
  const kind = group.toolKind === undefined ? '' : `${group.toolKind}; `;
  const angle =
    group.toolTipAngleDeg === undefined ? '' : `; angle-deg: ${fmt(group.toolTipAngleDeg)}`;
  return `; cnc tool: ${kind}diameter-mm: ${fmt(group.toolDiameterMm)}${angle}`;
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
