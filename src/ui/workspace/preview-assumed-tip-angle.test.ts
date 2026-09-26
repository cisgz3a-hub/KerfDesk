import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type CncTool } from '../../core/scene';
import { assumedTipAngleNotice } from './preview-assumed-tip-angle';

const TOOLPATH: Toolpath = {
  totalLength: 10,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      length: 10,
      z: { from: -1, to: -1 },
    },
  ],
};

function projectCutWith(tool: CncTool) {
  return {
    ...createProject(),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
  };
}

describe('assumedTipAngleNotice (ADR-425)', () => {
  it('names a V-bit the cut preview draws at an assumed angle', () => {
    const bit: CncTool = { id: 'v', name: 'Shop V-bit', kind: 'v-bit', diameterMm: 6.35 };
    expect(assumedTipAngleNotice(projectCutWith(bit), TOOLPATH)).toBe(
      'Shop V-bit has no valid tip angle, so the cut preview draws a 60° V. ' +
        'Set the angle in the bit library for its true shape.',
    );
  });

  it('says nothing for a V-bit with its angle, an end mill, or a laser project', () => {
    const angled: CncTool = {
      id: 'v',
      name: 'V',
      kind: 'v-bit',
      diameterMm: 6.35,
      tipAngleDeg: 90,
    };
    const flat: CncTool = { id: 'e', name: 'E', kind: 'end-mill', diameterMm: 3 };
    expect(assumedTipAngleNotice(projectCutWith(angled), TOOLPATH)).toBeNull();
    expect(assumedTipAngleNotice(projectCutWith(flat), TOOLPATH)).toBeNull();
    expect(assumedTipAngleNotice(createProject(), TOOLPATH)).toBeNull();
  });
});
