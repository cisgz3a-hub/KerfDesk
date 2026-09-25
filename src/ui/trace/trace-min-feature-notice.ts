// Post-commit minimum-feature notice (ADR-408). After a trace lands on a
// cutting operation, check just the new artwork and, when it has parts or gaps
// narrower than the kerf or bit, say so once — before the operator reaches
// Job Review, where the full list with positions lives. Advisory only.
// A laser Line operation counts only when its settings say it cuts through
// (Kerf Offset, tabs or extra passes): a Centerline or Edge trace lands on a
// plain Line operation that usually scores or engraves, and gets no notice.

import { checkProjectMinimumFeatures, type MinFeatureReport } from '../../core/min-feature';
import type { Project } from '../../core/scene';
import { formatFeatureMm } from '../laser/job-review/min-feature-warnings';

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function narrowestWidth(report: MinFeatureReport): number {
  const widths = [report.analysis.widths.minWidthMm, report.analysis.gaps.minWidthMm];
  return Math.min(...widths.map((width) => width ?? Infinity));
}

function reportNotice(report: MinFeatureReport): string {
  const { widths, gaps } = report.analysis;
  const found = [
    ...(widths.count > 0 ? [plural(widths.count, 'part', 'parts')] : []),
    ...(gaps.count > 0 ? [plural(gaps.count, 'gap', 'gaps')] : []),
  ].join(' and ');
  const cutter =
    report.machine === 'laser'
      ? `the ${formatFeatureMm(report.request.thresholdMm)} mm kerf`
      : `the ${formatFeatureMm(report.request.thresholdMm)} mm bit`;
  const pronoun = widths.count + gaps.count === 1 ? 'it' : 'they';
  const effect =
    report.machine === 'laser'
      ? `${pronoun} will burn away or merge when cut`
      : `the bit cannot cut ${pronoun === 'it' ? 'it' : 'them'} as drawn`;
  return (
    `The trace on "${report.layerName}" has ${found} narrower than ${cutter} ` +
    `(narrowest ${formatFeatureMm(narrowestWidth(report))} mm) — ${effect}. ` +
    'Job Review lists them; enlarge or simplify the trace to keep them.'
  );
}

/** Notice text for the traced object `tracedId`, or null when its cutting
 * operations have nothing narrower than their kerf or bit. */
export function traceMinFeatureNotice(project: Project, tracedId: string): string | null {
  const reports = checkProjectMinimumFeatures(project, {
    objectIds: new Set([tracedId]),
    declaredCutsOnly: true,
  });
  const flagged = reports
    .filter((report) => report.analysis.widths.count + report.analysis.gaps.count > 0)
    .sort((a, b) => narrowestWidth(a) - narrowestWidth(b));
  const worst = flagged[0];
  if (worst === undefined) return null;
  const others = flagged.length - 1;
  const suffix = others > 0 ? ` ${plural(others, 'other operation', 'other operations')} too.` : '';
  return reportNotice(worst) + suffix;
}

/** Check the committed trace after the dialog has closed, so a dense trace
 * never delays the commit, and warn if it has sub-kerf features. */
export function scheduleTraceMinFeatureNotice(
  tracedId: string,
  readProject: () => Project,
  pushWarning: (message: string) => void,
  schedule: (task: () => void) => void = (task) => {
    setTimeout(task, 0);
  },
): void {
  schedule(() => {
    const project = readProject();
    if (!project.scene.objects.some((object) => object.id === tracedId)) return;
    const notice = traceMinFeatureNotice(project, tracedId);
    if (notice !== null) pushWarning(notice);
  });
}
