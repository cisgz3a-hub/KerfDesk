// Minimum-feature advisories (ADR-408): cut geometry narrower than the kerf,
// beam or bit that cuts it. Warnings only — like every Job Review policy
// finding they inform the operator and never refuse Frame or Start (rule 7).
// Positions are machine coordinates of the narrowest point, the same frame as
// the Job size range for an Absolute job.

import {
  checkProjectMinimumFeatures,
  type MinFeatureFindings,
  type MinFeatureReport,
} from '../../../core/min-feature';
import type { Project } from '../../../core/scene';
import { formatCount, formatMm } from './job-review-format';

/** Extra positions listed after the narrowest one. */
const EXTRA_SITES_SHOWN = 2;
const SUB_HUNDREDTH_MM = 0.005;

const WIDTH_SOURCE_NOTES: Readonly<Record<MinFeatureReport['widthSource'], string>> = {
  'kerf-offset': ' (twice its Kerf Offset)',
  'spot-size': ' (the laser spot size)',
  'default-kerf': ' (assumed; set Kerf Offset to half your measured kerf)',
  tool: '',
};

const INCOMPLETE_BODY =
  'only partly checked for features narrower than the kerf or bit: the job is too large to check ' +
  'fully when Job Review opens.';

/** Width in mm for a minimum-feature message: two decimals, trailing zeros trimmed. */
export function formatFeatureMm(value: number): string {
  if (value < SUB_HUNDREDTH_MM) return 'under 0.01';
  return String(Number(value.toFixed(2)));
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function sitesText(findings: MinFeatureFindings): string {
  const [first, ...rest] = findings.sites;
  if (first === undefined) return '';
  const at = (site: typeof first): string =>
    `X ${formatMm(site.at.x)} · Y ${formatMm(site.at.y)} mm`;
  const extra = rest.slice(0, EXTRA_SITES_SHOWN).map(at);
  const also = extra.length === 0 ? '' : `; also at ${extra.join(' and ')}`;
  return `narrowest ${formatFeatureMm(first.widthMm)} mm at ${at(first)}${also}.`;
}

function cutterText(report: MinFeatureReport): string {
  const mm = formatFeatureMm(report.request.thresholdMm);
  if (report.machine === 'laser')
    return `the ${mm} mm kerf${WIDTH_SOURCE_NOTES[report.widthSource]}`;
  const name =
    report.toolName === undefined || report.toolName === '' ? 'bit' : `bit (${report.toolName})`;
  return `the ${mm} mm ${name}`;
}

type Grammar = { readonly it: string; readonly verb: (one: string, many: string) => string };

function grammar(count: number): Grammar {
  return count === 1
    ? { it: 'it', verb: (one) => `it ${one}` }
    : { it: 'them', verb: (_one, many) => `they ${many}` };
}

function widthConsequence(report: MinFeatureReport, count: number): string {
  const g = grammar(count);
  if (report.machine === 'laser') return g.verb('burns away or breaks', 'burn away or break');
  if (report.cutType === 'profile-on-path') return g.verb('is cut away', 'are cut away');
  return `the bit cannot enter ${g.it}, so ${g.verb('stays uncut', 'stay uncut')}`;
}

function gapConsequence(report: MinFeatureReport, count: number): string {
  const g = grammar(count);
  if (report.cutType === 'profile-outside') {
    return `the bit cannot fit into ${g.it}, so ${g.verb('stays uncut', 'stay uncut')}`;
  }
  return 'the cuts on each side merge';
}

function widthWarning(report: MinFeatureReport): string | null {
  const findings = report.analysis.widths;
  if (findings.count === 0) return null;
  const counted =
    report.machine === 'laser'
      ? plural(findings.count, 'part', 'parts')
      : plural(findings.count, 'area', 'areas');
  return (
    `Layer "${report.layerName}": ${counted} narrower than ${cutterText(report)} — ` +
    `${widthConsequence(report, findings.count)}; ${sitesText(findings)}`
  );
}

function gapWarning(report: MinFeatureReport): string | null {
  const findings = report.analysis.gaps;
  if (findings.count === 0) return null;
  const counted = plural(findings.count, 'gap', 'gaps');
  return (
    `Layer "${report.layerName}": ${counted} between cut shapes or lines narrower than ` +
    `${cutterText(report)} — ${gapConsequence(report, findings.count)}; ${sitesText(findings)}`
  );
}

/** Job Review warning strings for a set of minimum-feature reports. */
export function minFeatureWarnings(
  reports: ReadonlyArray<MinFeatureReport>,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  for (const report of reports) {
    const width = widthWarning(report);
    const gap = gapWarning(report);
    if (width !== null) warnings.push(width);
    if (gap !== null) warnings.push(gap);
  }
  const partial = [...new Set(reports.filter((r) => !r.analysis.complete).map((r) => r.layerName))];
  if (partial.length > 0) {
    const names = partial.map((name) => `"${name}"`).join(', ');
    warnings.push(
      `${partial.length === 1 ? 'Layer' : 'Layers'} ${names} ${partial.length === 1 ? 'was' : 'were'} ${INCOMPLETE_BODY}`,
    );
  }
  return warnings;
}

// The review model is rebuilt at Confirm from the same prepared project, and
// the check can take a few hundred milliseconds on a dense trace (ADR-408).
const warningsByProject = new WeakMap<Project, ReadonlyArray<string>>();

/** Minimum-feature warnings for the exact prepared (output-scoped) project. */
export function detectMinFeatureWarnings(project: Project): ReadonlyArray<string> {
  const cached = warningsByProject.get(project);
  if (cached !== undefined) return cached;
  const warnings = minFeatureWarnings(checkProjectMinimumFeatures(project));
  warningsByProject.set(project, warnings);
  return warnings;
}
