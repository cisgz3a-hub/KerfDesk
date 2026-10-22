// Controller audit v4 E4-P1-1 / E4-P2-1 (ADR-630 Amendment 6): what an opened
// program's own words may change, by the Console's rule.

import { describe, expect, it } from 'vitest';
import {
  externalProgramControllerEffects,
  externalProgramControllerStatePatch,
} from './external-program-controller-state';
import { initialLaserState } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

const NONE = { selectsOtherWcs: false, changesWorkZ: false };

describe('externalProgramControllerEffects', () => {
  it('reads a G55-G59 selection as leaving the WCS and voiding Work Z', () => {
    for (const select of ['G55', 'G59', 'G059', 'G0G56X1', 'G59.1']) {
      expect(externalProgramControllerEffects(`G21G90\n${select}\nG1X5F600\n`, 'G54')).toEqual({
        selectsOtherWcs: true,
        changesWorkZ: true,
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
      });
    }
  });

  it('leaves Work Z for XY-only offsets and plain motion', () => {
    for (const line of ['G92X0Y0', 'G10L2P1X5Y5', 'G1X5Y5F600', 'M3S1000', 'G4P0.5', 'M30']) {
      expect(externalProgramControllerEffects(`${line}\n`, 'G54'), line).toEqual(NONE);
    }
  });

  it('reads a G54 selection on an unknown system as a possible change', () => {
    expect(externalProgramControllerEffects('G54\nG1X5F600\n', null)).toEqual({
      selectsOtherWcs: true,
      changesWorkZ: true,
    });
  });
});

describe('externalProgramControllerStatePatch', () => {
  const probed = (): LaserState => ({
    ...initialLaserState(),
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
