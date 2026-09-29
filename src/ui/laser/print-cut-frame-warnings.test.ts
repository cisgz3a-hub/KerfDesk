import { describe, expect, it } from 'vitest';
import { solveTwoPointRegistration, type SimilarityTransform } from '../../core/registration';
import { createProject, type PrintAndCutDesignTargets } from '../../core/scene';
import { collectPrintCutFrameWarnings } from './print-cut-frame-warnings';

const targets: PrintAndCutDesignTargets = { first: { x: 20, y: 20 }, second: { x: 180, y: 20 } };
const project = { ...createProject(), printAndCutTargets: targets };

function registered(machine: readonly [{ x: number; y: number }, { x: number; y: number }]) {
  const solved = solveTwoPointRegistration({ design: [targets.first, targets.second], machine });
  if (!solved.ok) throw new Error(solved.reason);
  return solved.transform;
}

describe('Print-and-Cut warnings at Start', () => {
  it('reports a registration that looks like a capture mistake, and only warns', () => {
    // The targets captured in the swapped order: the job turned 180°.
    const swapped: SimilarityTransform = registered([targets.second, targets.first]);
    const warnings = collectPrintCutFrameWarnings(project, swapped, undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Print-and-Cut registration: The captured points are');
    expect(warnings[0]).toContain('turned 180.0°');
    expect(warnings[0]).toContain('capturing the two targets in the swapped order');
  });

  it('says nothing about a registration that looks like the sheet', () => {
    const sheet = registered([
      { x: 25, y: 22 },
      { x: 185.08, y: 24.8 },
    ]);
    expect(collectPrintCutFrameWarnings(project, sheet, undefined)).toEqual([]);
  });

  it('says nothing without an active registration', () => {
    expect(collectPrintCutFrameWarnings(project, undefined, undefined)).toEqual([]);
    expect(collectPrintCutFrameWarnings(project, null, undefined)).toEqual([]);
  });
});
