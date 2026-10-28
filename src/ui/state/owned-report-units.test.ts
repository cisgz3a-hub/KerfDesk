// Rolling audit v5 J7-P1-1: KerfDesk's own program also selects G21 on
// Smoothieware. A recovery frames nothing first, so its program can leave the
// board in other units than KerfDesk reads in (ADR-375 Amendment 11).
import { beforeEach, describe, expect, it } from 'vitest';
import { grblDriver, smoothiewareDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { ownedProgramReportUnitsPatch } from './owned-report-units';
import { resetStore } from './test-helpers';

const PROGRAM = 'G21 G90 G54 G94 G17 M4 S0\nG0 X10 Y10\nG1 X20 S500\nM5\nM2\n';

beforeEach(() => {
  resetStore();
});

function readingInches() {
  return { ...useLaserStore.getState(), controllerSettings: { reportInches: true } };
}

describe('ownedProgramReportUnitsPatch', () => {
  it('hides positions when the program selects millimetres while KerfDesk reads inches', () => {
    const patch = ownedProgramReportUnitsPatch(readingInches(), PROGRAM, smoothiewareDriver);
    expect(patch).toMatchObject({ reportUnitsUnconfirmed: true, wcoCache: null });
    expect(patch.log?.at(-1)).toMatch(/stays hidden until \$G or the next Frame/);
  });

  it('changes nothing after a Frame, which selected millimetres first', () => {
    const framed = { ...useLaserStore.getState(), controllerSettings: { reportInches: false } };
    expect(ownedProgramReportUnitsPatch(framed, PROGRAM, smoothiewareDriver)).toEqual({});
  });

  it("changes nothing where position reports follow $13, not the program's units", () => {
    expect(ownedProgramReportUnitsPatch(readingInches(), PROGRAM, grblDriver)).toEqual({});
  });
});
