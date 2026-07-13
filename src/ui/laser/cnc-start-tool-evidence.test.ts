import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { CncGroup } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { cncToolPlan } from '../state/cnc-tool-plan';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const object: SceneObject = {
  kind: 'imported-svg',
  id: 'tool-evidence-line',
  source: 'line.svg',
  bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
        },
      ],
    },
  ],
};

const project: Project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  scene: {
    ...EMPTY_SCENE,
    objects: [object],
    layers: [createLayer({ id: 'red', color: '#ff0000' })],
  },
};
const controller = { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false };
const machine = { statusReport: idleStatus, alarmCode: null, hasActiveStreamer: false };

function prepareFor(toolId: string | undefined) {
  return prepareStartJob(project, controller, {
    ...machine,
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'probe',
      referenceEpoch: 7,
      probePlateRemoved: true,
      ...(toolId === undefined ? {} : { toolId }),
    },
  });
}

function group(toolId: string, toolName: string): CncGroup {
  return {
    kind: 'cnc',
    layerId: toolId,
    color: '#ff0000',
    cutType: 'engrave',
    toolId,
    toolName,
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 200,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 5,
    passes: [],
  };
}

describe('CNC Start tool-bound work-Z evidence', () => {
  it('collapses adjacent groups into the exact M0 cutter-section plan', () => {
    expect(
      cncToolPlan({ groups: [group('a', 'Tool A'), group('a', 'Tool A'), group('b', 'Tool B')] }),
    ).toEqual([
      { id: 'a', name: 'Tool A' },
      { id: 'b', name: 'Tool B' },
    ]);
  });

  it('accepts evidence for the first exact compiled tool and returns its stream plan', () => {
    const result = prepareFor('em-3175');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cncToolPlan).toEqual([{ id: 'em-3175', name: '3.175 mm (1/8") end mill' }]);
    }
  });

  it('blocks current evidence for a different or unrecorded bit', () => {
    const wrong = prepareFor('em-6350');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.messages.join('\n')).toContain('This job starts with 3.175 mm');
      expect(wrong.messages.join('\n')).toContain('work Z was established for 6.35 mm');
    }

    const unknown = prepareFor(undefined);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.messages.join('\n')).toContain('an unrecorded bit');
  });
});
