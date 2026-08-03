// defaultCncTextCutType only picks the cut type a NEW text object starts on.
// It never restricts what the operator may choose afterwards — steering a
// default is not a guard, and every cut type stays selectable for every layer
// (rule 7). The advisory that tells an operator when open strokes will produce
// no toolpath lives in CncOpenPathNote, keyed on measured compiler behaviour
// rather than on the font.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTool, type MachineConfig } from '../../core/scene';
import { defaultCncTextCutType } from './text-layer-policy';

const VBIT: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const END_MILL: CncTool = { id: 'em3', name: '3 mm end mill', kind: 'end-mill', diameterMm: 3 };

function cncMachine(tool: CncTool): MachineConfig {
  return { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id };
}

describe('defaultCncTextCutType', () => {
  it('starts outline fonts on V-carve when a v-bit is loaded', () => {
    expect(defaultCncTextCutType(cncMachine(VBIT), 'roboto-regular')).toBe('v-carve');
  });

  it('starts single-line fonts on engrave, which follows their open strokes', () => {
    expect(defaultCncTextCutType(cncMachine(VBIT), 'ems-decorous-script')).toBe('engrave');
  });

  it('does not default to V-carve without a v-bit', () => {
    expect(defaultCncTextCutType(cncMachine(END_MILL), 'roboto-regular')).toBe('engrave');
  });

  it('falls back to engrave when there is no CNC machine', () => {
    expect(defaultCncTextCutType(undefined, 'roboto-regular')).toBe('engrave');
  });
});
