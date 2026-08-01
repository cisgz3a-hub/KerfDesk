import { describe, expect, it } from 'vitest';

import { COMPILE_INTEGRITY_PREFLIGHT_CODES, type PreflightIssue } from '../../core/preflight';
import { partitionSavePreflight } from './save-preflight-policy';

describe('partitionSavePreflight', () => {
  it('blocks only compile-integrity failures — the program cannot be produced', () => {
    const issues: ReadonlyArray<PreflightIssue> = [
      { code: 'non-finite-coordinate', message: 'Line 3: X is NaN.' },
      { code: 'empty-output', message: 'No cuts.' },
    ];

    const split = partitionSavePreflight(issues);

    expect(split.blocking).toEqual(issues);
    expect(split.advisories).toEqual([]);
  });

  // Rule 7 / ADR-228 regression pin. This file previously listed the ADVISORIES
  // and blocked everything else, so these policy findings refused the export
  // while the identical findings only warned on Start. If any of them turns up
  // in `blocking` again, a guard has been re-added.
  //
  // The 2026-07-25 CNC full-chain audit reached the same conclusion from the
  // other end (finding 4.3): rule 7 says configured no-go zones "may warn in
  // Job Review, but must never refuse Frame or Start", yet the export path
  // still refused them, so a job Start would happily stream could not be
  // written to a file. 'no-go-zone-collision' and 'scan-offset-above-cap'
  // below are that finding's two codes.
  it('never refuses a save for a heuristic policy finding', () => {
    const policyIssues: ReadonlyArray<PreflightIssue> = [
      { code: 'out-of-bed', message: 'Line 9: X exceeds the bed.' },
      { code: 'no-go-zone-collision', message: 'Crosses a no-go zone.' },
      { code: 'plunged-travel', message: 'XY rapid below safe Z.' },
      { code: 'speed-out-of-range', message: 'Layer L1 speed exceeds the device maximum.' },
      { code: 'power-out-of-range', message: 'Layer L1 power exceeds 100%.' },
      { code: 'cnc-settings-invalid', message: 'Step-down must be positive.' },
      { code: 'scan-offset-above-cap', message: 'Scan offset 4.01 mm exceeds ±4 mm.' },
      { code: 'scan-offset-out-of-range', message: 'Layer L1 scan offset NaN must be finite.' },
    ];

    const split = partitionSavePreflight(policyIssues);

    expect(split.blocking).toEqual([]);
    expect(split.advisories).toEqual(policyIssues);
  });

  it('splits a mixed batch without dropping or reordering issues', () => {
    const split = partitionSavePreflight([
      { code: 'out-of-bed', message: 'Line 9: X exceeds the bed.' },
      { code: 'empty-output', message: 'No cuts.' },
      { code: 'plunged-travel', message: 'XY rapid below safe Z.' },
    ]);

    expect(split.blocking.map((i) => i.code)).toEqual(['empty-output']);
    expect(split.advisories.map((i) => i.code)).toEqual(['out-of-bed', 'plunged-travel']);
  });

  // The Save path must refuse exactly what the Start path refuses. Both read
  // this one set; if someone re-introduces a private list in either file, the
  // paths can drift apart again — which is the defect this replaced.
  it('is keyed off the canonical compile-integrity set', () => {
    expect([...COMPILE_INTEGRITY_PREFLIGHT_CODES].sort()).toEqual([
      'cnc-tool-geometry-invalid',
      'empty-output',
      'no-output-layer',
      'non-finite-coordinate',
      'program-materialization-failed',
      'relief-needs-cnc',
    ]);
    expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('out-of-bed')).toBe(false);
  });
});
