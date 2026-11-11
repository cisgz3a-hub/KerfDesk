import { PROFILE_OUTLINE_GAP_MM } from '../cnc/cnc-profile-outline-join';
import type { Job } from '../job';
import type { CncKeptPartCut, CncProfileOpenPaths } from '../job/cnc-compilation-sidecar-types';
import type { PreflightIssue } from './preflight';
import { formatUpTo2Decimals } from '../util/number-format';

// Advisory only (rule 7, ADR-565): each program is cut as compiled. Read from
// the evidence retained with this exact Job, so fresh and archived review agree.

/**
 * ADR-672: per Outside or Inside profile, the open paths cut on their line
 * (a part or hole one cut width off size) and the outlines it closed.
 */
export function cncProfileOpenPathIssues(job: Job | undefined): ReadonlyArray<PreflightIssue> {
  return (job?.cncCompilation?.profileOpenPaths ?? []).flatMap((entry) => [
    ...(entry.onLine > 0 ? [onLineIssue(entry)] : []),
    ...(entry.joined > 0 ? [joinedIssue(entry)] : []),
  ]);
}

function onLineIssue(entry: CncProfileOpenPaths): PreflightIssue {
  const one = entry.onLine === 1;
  const outside = entry.cutType === 'profile-outside';
  const side = outside ? 'outside' : 'inside';
  const outlined = outside ? 'A part' : 'A hole';
  const size = outside ? 'smaller' : 'larger';
  return {
    code: 'cnc-profile-open-path-on-line',
    message:
      `Layer "${entry.layerName}": ${entry.onLine} open path${one ? ' is' : 's are'} cut on ` +
      `${one ? 'its' : 'their'} line, not ${side} ${one ? 'it' : 'them'}: only a closed shape ` +
      `has an ${side}. ${outlined} ${one ? 'it outlines' : 'they outline'} comes out ` +
      `${formatUpTo2Decimals(entry.cutWidthMm)} mm ${size} than drawn (one cut width). Close the outline with ` +
      'Tools > Join paths, or choose On path for this layer.',
  };
}

function joinedIssue(entry: CncProfileOpenPaths): PreflightIssue {
  const one = entry.joined === 1;
  const side = entry.cutType === 'profile-outside' ? 'outside' : 'inside';
  return {
    code: 'cnc-profile-outline-closed',
    message:
      `Layer "${entry.layerName}": ${entry.joined} outline${one ? ' is' : 's are'} drawn as ` +
      `open paths whose ends meet within ${PROFILE_OUTLINE_GAP_MM} mm; ${one ? 'it is' : 'they are'} ` +
      `closed and cut ${side} ${one ? 'its line as a closed shape' : 'their lines as closed shapes'}.`,
  };
}

/**
 * ADR-433 Amendment 3: per pair of profile operations, where one's cutter
 * reaches a part the other keeps. Positions are machine coordinates, so they
 * are given only when the program runs where it was compiled (not from a
 * hand-set origin, a motion offset or a tile's own zero; Amendment 5).
 */
export function cncKeptPartCutIssues(
  job: Job | undefined,
  showPositions: boolean,
): ReadonlyArray<PreflightIssue> {
  return (job?.cncCompilation?.keptPartCuts ?? []).map((cut) => keptPartIssue(cut, showPositions));
}

function keptPartIssue(cut: CncKeptPartCut, showPositions: boolean): PreflightIssue {
  const one = cut.contours === 1;
  const parts = `${cut.contours} part${one ? '' : 's'} that layer "${cut.keptLayerName}" keeps`;
  const where = showPositions
    ? ` at X ${formatUpTo2Decimals(cut.at.x)} · Y ${formatUpTo2Decimals(cut.at.y)} mm`
    : '';
  const reach =
    cut.depthMm === null
      ? `runs into ${parts}${where}`
      : `reaches ${parts} and cuts up to ${formatUpTo2Decimals(cut.depthMm)} mm into ${one ? 'it' : 'them'}${where}`;
  return {
    code: 'cnc-profile-cuts-kept-part',
    message: `Layer "${cut.layerName}": its ${formatUpTo2Decimals(cut.cutWidthMm)} mm cut ${reach}. ${keptPartCause(cut)}`,
  };
}

// ADR-433 Amendment 5: when only the roughing ring reaches the part, the bit
// does pass between the parts; the finish allowance moves roughing out to it.
function keptPartCause(cut: CncKeptPartCut): string {
  const allowance = cut.finishAllowanceMm;
  if (allowance === undefined || cut.depthMm === null) {
    return 'The parts sit closer together than the bit can pass between. Move them further apart.';
  }
  const them = cut.contours === 1 ? 'it' : 'them';
  const moved = `Its ${formatUpTo2Decimals(allowance)} mm finish allowance moves the roughing pass out into ${them}.`;
  // Each 0.01 mm less allowance draws the roughing ring 0.01 mm back. Rounded
  // down (past binary rounding), so the figure clears even where the offset's
  // own rounding decides.
  const clearing = Math.floor((allowance - cut.depthMm) * 100 + 1e-9) / 100;
  return clearing > 0
    ? `${moved} An allowance of ${formatUpTo2Decimals(clearing)} mm or less clears ${them}, or move the parts apart.`
    : `${moved} Remove the allowance or move the parts apart.`;
}
