// ADR-483: Job Review's note for a laser finish position preparation set aside.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, type Project } from '../../core/scene';
import type { Job } from '../../core/job';
import {
  detectLaserFinishSetAsideWarnings,
  laserFinishSetAsideWarning,
} from './laser-finish-set-aside-warnings';

function project(dialectId: 'grbl-dynamic' | 'neotronics-4040-safe'): Project {
  return createProject({
    ...DEFAULT_DEVICE_PROFILE,
    gcodeDialect: { dialectId },
    laserFinishPosition: { kind: 'bed', xMm: 10, yMm: 0 },
  });
}

const UNPLACED: Job = { groups: [], laserFinish: { kind: 'set-aside', reason: 'unplaced' } };
const ROTARY: Job = { groups: [], laserFinish: { kind: 'set-aside', reason: 'rotary' } };

describe('laser finish set-aside note', () => {
  it('says why, and where the head goes instead', () => {
    expect(detectLaserFinishSetAsideWarnings(project('grbl-dynamic'), UNPLACED)).toEqual([
      'The finish position at canvas X 10 · Y 0 mm is set aside for this job because where the ' +
        'job sits on the bed is unknown. The head goes to the work origin instead (back to the ' +
        'start for a Current Position job). It is placed once the bed mapping is verified: a ' +
        'confirmed Home this session on a controller whose settings, build and travel match the ' +
        'profile bed. Verified Origin jobs never place it.',
    ]);
    expect(detectLaserFinishSetAsideWarnings(project('grbl-dynamic'), ROTARY)).toEqual([
      'The finish position at canvas X 10 · Y 0 mm is set aside for this job because the rotary ' +
        'is on. The head goes to the work origin instead (back to the start for a Current ' +
        'Position job).',
    ]);
  });

  it('names the dialect default when that default does not park', () => {
    expect(detectLaserFinishSetAsideWarnings(project('neotronics-4040-safe'), UNPLACED)).toEqual([
      laserFinishSetAsideWarning(10, 0, 'unplaced', false),
    ]);
    expect(laserFinishSetAsideWarning(10, 0, 'unplaced', false)).toContain(
      'The head stays where the job ends instead',
    );
  });

  it('stays silent for a placed, stay or absent finish', () => {
    const placed: Job = { groups: [], laserFinish: { kind: 'point', x: 1, y: 2 } };
    expect(detectLaserFinishSetAsideWarnings(project('grbl-dynamic'), placed)).toEqual([]);
    expect(detectLaserFinishSetAsideWarnings(project('grbl-dynamic'), { groups: [] })).toEqual([]);
    expect(detectLaserFinishSetAsideWarnings(project('grbl-dynamic'), undefined)).toEqual([]);
  });
});
