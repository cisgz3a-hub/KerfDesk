import { activeCncTool, type CncCutType, type MachineConfig } from '../../core/scene';
import { findFontEntry } from '../../core/text';

export function defaultCncTextCutType(
  machine: MachineConfig | undefined,
  fontKey: string,
): CncCutType {
  return machine?.kind === 'cnc' &&
    findFontEntry(fontKey)?.geometry !== 'single-line' &&
    activeCncTool(machine).kind === 'v-bit'
    ? 'v-carve'
    : 'engrave';
}

export function isTextCutTypeCompatible(fontKey: string, cutType: CncCutType): boolean {
  if (findFontEntry(fontKey)?.geometry !== 'single-line') return true;
  return cutType === 'engrave' || cutType === 'profile-on-path';
}
