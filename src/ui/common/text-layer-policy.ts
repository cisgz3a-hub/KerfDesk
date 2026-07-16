import { activeCncTool, type CncCutType, type MachineConfig } from '../../core/scene';

export function defaultCncTextCutType(
  machine: MachineConfig | undefined,
  _fontKey: string,
): CncCutType {
  return machine?.kind === 'cnc' && activeCncTool(machine).kind === 'v-bit' ? 'v-carve' : 'engrave';
}

export function isTextCutTypeCompatible(_fontKey: string, _cutType: CncCutType): boolean {
  return true;
}
