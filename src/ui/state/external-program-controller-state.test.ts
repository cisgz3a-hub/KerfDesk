// Controller audit v4 E4-P1-1 / E4-P2-1 (ADR-630 Amendment 6): what an opened
// program's own words may change, by the Console's rule.

import { describe, expect, it } from 'vitest';
import {
  externalProgramControllerEffects,
  externalProgramControllerStatePatch,
} from './external-program-controller-state';
import { useLaserStore, type LaserState } from './laser-store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

const NONE = { selectsOtherWcs: false, changesWorkZ: false, changesWorkOrigin: false };

describe('externalProgramControllerEffects', () => {
  it('reads a G55-G59 selection as leaving the WCS and voiding both offsets', () => {
    for (const select of ['G55', 'G59', 'G059', 'G0G56X1', 'G59.1']) {
      expect(externalProgramControllerEffects(`G21G90\n${select}\nG1X5F600\n`, 'G54')).toEqual({
        selectsOtherWcs: true,
        changesWorkZ: true,
        changesWorkOrigin: true,
      });
    }
  });

  it('keeps both records for a CAM header that selects the active G54', () => {
    expect(
      externalProgramControllerEffects(
        'G90G94G17G21G54\nG54G0X0Y0\nM3S1000\nG1X5F600\nM30\n',
        'G54',
      ),
    ).toEqual(NONE);
  });

  it('voids Work Z for the Z-offset and tool words the Console voids it for', () => {
    for (const line of [
      'G92Z0',
      'G92.1',
      'G10L2P1Z-3',
      'G10L20P0Z0',
      'G54G10L20P0Z0',
      'G43.1Z5',
      'G49',
      'M6',
      'M06T2',
      'T2',
    ]) {
      expect(externalProgramControllerEffects(`G0X0\n${line}\nG1X5F600\n`, 'G54'), line).toEqual({
        selectsOtherWcs: false,
        changesWorkZ: true,
        // G92.1 clears every axis offset.
        changesWorkOrigin: line === 'G92.1',
      });
    }
  });

  // ADR-630 Amendment 8 (meta audit M4-P1-2): grblHAL with a tool table keeps
  // these offsets through M30 and a soft reset, with no T or M6 in the file.
  it('voids Work Z for the grblHAL tool-table offset words', () => {
    for (const line of ['G43H1', 'G43 H2', 'G0G43Z5H1', 'G43', 'G43.2H3', 'M61Q2', 'G49']) {
      expect(
        externalProgramControllerEffects(`G21G90G54\nG0X0Y0\n${line}\nG1X5F600\nM30\n`, 'G54'),
        line,
      ).toEqual({ selectsOtherWcs: false, changesWorkZ: true, changesWorkOrigin: false });
    }
  });

  // Audit follow-up to #1413: an X/Y offset the program writes moves the work
  // origin KerfDesk set, as the Console's coordinates-xy effect says.
  it('voids the X/Y work origin, not Work Z, for XY-only offsets', () => {
    for (const line of ['G92X0Y0', 'G10L2P1X5Y5', 'G10L20P0X0']) {
      expect(externalProgramControllerEffects(`${line}\n`, 'G54'), line).toEqual({
        ...NONE,
        changesWorkOrigin: true,
      });
    }
  });

  it('changes nothing for plain motion and machine words', () => {
    for (const line of ['G1X5Y5F600', 'M3S1000', 'G4P0.5', 'M30']) {
      expect(externalProgramControllerEffects(`${line}\n`, 'G54'), line).toEqual(NONE);
    }
  });

  it('reads a G54 selection on an unknown system as a possible change', () => {
    expect(externalProgramControllerEffects('G54\nG1X5F600\n', null)).toEqual({
      selectsOtherWcs: true,
      changesWorkZ: true,
      changesWorkOrigin: true,
    });
  });
});

describe('externalProgramControllerStatePatch', () => {
  const probed = (): LaserState => ({
    ...useLaserStore.getState(),
    activeWcs: 'G54',
    workZReferenceEpoch: 4,
    workZZeroEvidence: captureWorkZZeroEvidence('probe', 4),
  });

  it('makes the WCS unknown and Work Z stale after a G55 program', () => {
    const patch = externalProgramControllerStatePatch(probed(), 'G55\nG0X5\n');
    expect(patch).toMatchObject({
      activeWcs: null,
      workZZeroEvidence: null,
      workZReferenceEpoch: 5,
    });
    expect(patch.log?.at(-1)).toContain('other than G54');
  });

  it('keeps the known WCS when only Work Z changes', () => {
    const patch = externalProgramControllerStatePatch(probed(), 'G92Z0\nG1Z-1F100\n');
    expect(patch).not.toHaveProperty('activeWcs');
    expect(patch).toMatchObject({ workZZeroEvidence: null, workZReferenceEpoch: 5 });
  });

  it('makes Work Z stale after a grblHAL G43 H program with no tool change', () => {
    const patch = externalProgramControllerStatePatch(
      probed(),
      'G21G90G54\nG43H1\nG0Z5\nG1Z-1F100\nM30\n',
    );
    expect(patch).not.toHaveProperty('activeWcs');
    expect(patch).toMatchObject({ workZZeroEvidence: null, workZReferenceEpoch: 5 });
    expect(patch.log?.at(-1)).toContain('Work Z set before it no longer applies');
  });

  it('drops the work origin KerfDesk set after a program that writes G92 X Y', () => {
    const patch = externalProgramControllerStatePatch(
      { ...probed(), workOriginActive: true, workOriginSource: 'g92' },
      'G21G90G54\nG92X0Y0\nG1X5F600\nM30\n',
    );
    expect(patch).toMatchObject({
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache: null,
      workOriginVersion: (probed().workOriginVersion ?? 0) + 1,
    });
    expect(patch).not.toHaveProperty('workZZeroEvidence');
    expect(patch.log?.at(-1)).toContain('the work origin set before it no longer applies');
  });

  it('changes nothing for a program that touches neither record', () => {
    expect(externalProgramControllerStatePatch(probed(), 'G21G90G54\nG1X5F600\nM30\n')).toEqual({});
  });

  it('leaves an unknown WCS unknown', () => {
    const patch = externalProgramControllerStatePatch(
      { ...probed(), activeWcs: null },
      'G55\nG0X5\n',
    );
    expect(patch).not.toHaveProperty('activeWcs');
    expect(patch).toMatchObject({ workZZeroEvidence: null });
  });
});
