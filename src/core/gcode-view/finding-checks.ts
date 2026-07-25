// Individual Program Health checks (ADR-255 stage 6). Each reads only the
// render model and returns findings — never throws, never blocks, never
// consults device or machine state (that would make it a policy judgment).

import type { ProgramFinding } from './finding-types';
import { LINE_CATEGORY, SEG_KIND, SEG_MOTION, type GcodeRenderModel } from './render-model-types';

/** A rapid this far below Z0 is genuinely below the work surface, not noise. */
const BELOW_SURFACE_EPSILON_MM = 0.001;

export function unsupportedWordFindings(model: GcodeRenderModel): ReadonlyArray<ProgramFinding> {
  return model.unsupportedWords.map((entry) => ({
    id: `unsupported-word:${entry.word}`,
    severity: 'info' as const,
    title: `Unsupported word ${entry.word}`,
    detail: `${entry.word} is not interpreted by the Inspector, so its effect is not shown. The controller may still act on it.`,
    line: entry.firstLine,
    count: entry.count,
  }));
}

export function skippedMotionFinding(model: GcodeRenderModel): ProgramFinding | null {
  const first = model.skippedMotions[0];
  if (first === undefined) return null;
  return {
    id: 'skipped-motion',
    severity: 'notice',
    title: 'Some moves could not be drawn',
    detail: `${model.skippedMotions.length} motion line(s) produced no geometry. First: line ${first.line + 1} — ${first.reason}.`,
    line: first.line,
    count: model.skippedMotions.length,
  };
}

export function junkLineFinding(model: GcodeRenderModel): ProgramFinding | null {
  const tally = countCategory(model, LINE_CATEGORY.junk);
  if (tally === null) return null;
  return {
    id: 'junk-line',
    severity: 'notice',
    title: 'Unreadable lines',
    detail: `${tally.count} line(s) held no recognizable G-code words and were skipped.`,
    line: tally.firstLine,
    count: tally.count,
  };
}

export function afterEndFinding(model: GcodeRenderModel): ProgramFinding | null {
  const tally = countCategory(model, LINE_CATEGORY.afterEnd);
  if (tally === null) return null;
  return {
    id: 'lines-after-end',
    severity: 'notice',
    title: 'Lines after the program end',
    detail: `${tally.count} line(s) follow M2/M30 and will not run.`,
    line: tally.firstLine,
    count: tally.count,
  };
}

export function noMotionFinding(model: GcodeRenderModel): ProgramFinding | null {
  if (model.segmentCount > 0) return null;
  return {
    id: 'no-motion',
    severity: 'notice',
    title: 'No motion found',
    detail: 'The program parsed but contains no moves, so there is nothing to show in 3D.',
    line: null,
    count: 1,
  };
}

/**
 * Lateral rapids while below Z0 — the tool is driven sideways through the
 * work at rapid speed. A rapid RETRACT also starts below Z0 and is correct,
 * so height alone is not the signal: only XY motion down there is.
 */
export function rapidThroughMaterialFinding(model: GcodeRenderModel): ProgramFinding | null {
  const scan = scanRapids(
    model,
    SEG_KIND.travel,
    (z0, z1) => Math.min(z0, z1) < -BELOW_SURFACE_EPSILON_MM,
  );
  if (scan === null) return null;
  return {
    id: 'rapid-through-material',
    severity: 'warning',
    title: 'Rapid moves across the work below Z0',
    detail: `${scan.count} rapid (G0) move(s) travel in X/Y while at or below Z0, down to Z ${scan.deepest.toFixed(2)} mm. Rapids are not feed-limited.`,
    line: scan.firstLine,
    count: scan.count,
  };
}

/** Rapids that descend below Z0 — entering the work at rapid speed. */
export function rapidPlungeFinding(model: GcodeRenderModel): ProgramFinding | null {
  const scan = scanRapids(model, SEG_KIND.plunge, (_z0, z1) => z1 < -BELOW_SURFACE_EPSILON_MM);
  if (scan === null) return null;
  return {
    id: 'rapid-plunge',
    severity: 'warning',
    title: 'Rapid plunge below Z0',
    detail: `${scan.count} rapid (G0) move(s) descend below Z0, to Z ${scan.deepest.toFixed(2)} mm, instead of feeding in at plunge rate.`,
    line: scan.firstLine,
    count: scan.count,
  };
}

function scanRapids(
  model: GcodeRenderModel,
  kind: number,
  matches: (z0: number, z1: number) => boolean,
): { readonly count: number; readonly firstLine: number; readonly deepest: number } | null {
  let count = 0;
  let firstLine = -1;
  let deepest = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segMotion[index] !== SEG_MOTION.rapid || model.segKind[index] !== kind) continue;
    const base = index * 6;
    const z0 = model.positions[base + 2] ?? 0;
    const z1 = model.positions[base + 5] ?? 0;
    if (!matches(z0, z1)) continue;
    count += 1;
    deepest = Math.min(deepest, z0, z1);
    if (firstLine < 0) firstLine = model.segLine[index] ?? 0;
  }
  return firstLine < 0 ? null : { count, firstLine, deepest };
}

export function cutBeforeSpindleFinding(model: GcodeRenderModel): ProgramFinding | null {
  const firstCut = firstCuttingSegment(model);
  if (firstCut === null) return null;
  const firstCutLine = model.segLine[firstCut] ?? 0;
  const spindleOn = model.events.find((event) => event.kind === 'spindle-on');
  if (spindleOn !== undefined && spindleOn.line <= firstCutLine) return null;
  const detail =
    spindleOn === undefined
      ? 'The program cuts without ever switching the spindle or laser on (no M3/M4).'
      : `The first cutting move is on line ${firstCutLine + 1}, before the spindle/laser is switched on at line ${spindleOn.line + 1}.`;
  return {
    id: 'cut-before-spindle',
    severity: 'warning',
    title: 'Cutting begins before spindle/laser on',
    detail,
    line: firstCutLine,
    count: 1,
  };
}

export function cutWithoutFeedFinding(model: GcodeRenderModel): ProgramFinding | null {
  let count = 0;
  let firstLine: number | null = null;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (!isCutting(model, index)) continue;
    if (model.segMotion[index] === SEG_MOTION.rapid) continue;
    if ((model.segFeed[index] ?? 0) > 0) continue;
    count += 1;
    if (firstLine === null) firstLine = model.segLine[index] ?? 0;
  }
  if (firstLine === null) return null;
  return {
    id: 'cut-without-feed',
    severity: 'warning',
    title: 'Cutting moves with no feed rate',
    detail: `${count} cutting move(s) run with no F word ever set. Most controllers reject a feed move without a feed rate.`,
    line: firstLine,
    count,
  };
}

export function unitsNotDeclaredFinding(model: GcodeRenderModel): ProgramFinding | null {
  if (model.segmentCount === 0) return null;
  if (model.events.some((event) => event.kind === 'units')) return null;
  return {
    id: 'units-not-declared',
    severity: 'notice',
    title: 'No units word',
    detail:
      'The program never states G20 (inch) or G21 (mm). Millimetres were assumed; the controller uses whatever mode it is already in.',
    line: null,
    count: 1,
  };
}

export function noProgramEndFinding(model: GcodeRenderModel): ProgramFinding | null {
  if (model.segmentCount === 0) return null;
  if (model.events.some((event) => event.kind === 'program-end')) return null;
  return {
    id: 'no-program-end',
    severity: 'info',
    title: 'No program end',
    detail: 'The program has no M2 or M30 end word.',
    line: null,
    count: 1,
  };
}

function firstCuttingSegment(model: GcodeRenderModel): number | null {
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (isCutting(model, index)) return index;
  }
  return null;
}

function isCutting(model: GcodeRenderModel, index: number): boolean {
  const kind = model.segKind[index];
  return kind === SEG_KIND.cut || kind === SEG_KIND.plunge;
}

function countCategory(
  model: GcodeRenderModel,
  category: number,
): { readonly count: number; readonly firstLine: number } | null {
  let count = 0;
  let firstLine = -1;
  for (let line = 0; line < model.lineCount; line += 1) {
    if (model.lineCategories[line] !== category) continue;
    count += 1;
    if (firstLine < 0) firstLine = line;
  }
  return firstLine < 0 ? null : { count, firstLine };
}
