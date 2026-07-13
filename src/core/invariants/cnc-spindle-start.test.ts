import { describe, expect, it } from 'vitest';
import { findSpindleStartClearanceIssues } from './cnc-motion';

describe('findSpindleStartClearanceIssues', () => {
  it('accepts spindle starts after a safe-Z move', () => {
    expect(findSpindleStartClearanceIssues('G0 Z5\nM3 S12000', { safeZMm: 5 })).toEqual([]);
  });

  it('rejects spindle starts before any clearance move', () => {
    expect(findSpindleStartClearanceIssues('G90\nM3 S12000\nG0 Z5', { safeZMm: 5 })).toEqual([
      {
        lineNumber: 2,
        reason: 'M3 spindle start occurs before any Z clearance was established.',
      },
    ]);
  });

  it('rejects a restart after Z returned below the safe height', () => {
    const issues = findSpindleStartClearanceIssues('G0 Z5\nM3 S12000\nG1 Z-1\nM5\nM3 S9000', {
      safeZMm: 5,
    });
    expect(issues).toEqual([
      {
        lineNumber: 5,
        reason: 'M3 spindle start occurs at Z-1.000, below safe height 5.000 mm.',
      },
    ]);
  });
});
