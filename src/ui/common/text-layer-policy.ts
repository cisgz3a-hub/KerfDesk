import { activeCncTool, type CncCutType, type MachineConfig } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { proFeaturesUnlocked } from '../licensing/edition';

// New text on a V-bit starts as a V-carve only where V-carve, a Pro tool, is
// available; KerfDesk Free quietly starts it as an engrave (ADR-540).
export function defaultCncTextCutType(
  machine: MachineConfig | undefined,
  fontKey: string,
): CncCutType {
  return machine?.kind === 'cnc' &&
    findFontEntry(fontKey)?.geometry !== 'single-line' &&
    activeCncTool(machine).kind === 'v-bit' &&
    proFeaturesUnlocked()
    ? 'v-carve'
    : 'engrave';
}
