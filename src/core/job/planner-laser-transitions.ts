import { resolveGrblDialect, type DeviceProfile } from '../devices';
import type { Block } from '../motion-planner';
import { laserModeWord, vectorPowerWord } from '../output/grbl-power-modes';
import type { CutGroup, FillGroup, RasterGroup } from './job';

type LaserPlannerState = {
  mode: 'M3' | 'M4' | 'off';
  coolant: 'off' | 'M7' | 'M8';
};

export function initialLaserPlannerState(device: DeviceProfile): LaserPlannerState {
  return { mode: laserModeWord(resolveGrblDialect(device).cutPowerMode), coolant: 'off' };
}

/** Mirrors the emitter's real non-motion changes. A changed S on an ordinary
 * G1 seek or burn remains inside the same feed-motion chain. */
export function beginLaserPlannerGroup(
  blocks: Block[],
  group: CutGroup | FillGroup | RasterGroup,
  device: DeviceProfile,
  state: LaserPlannerState,
): void {
  const mode = group.kind === 'raster' ? 'off' : vectorPowerWord(group, resolveGrblDialect(device));
  const coolant = group.airAssist ? device.airAssistCommand : 'off';
  const nextCoolant = coolant === 'none' ? 'off' : coolant;
  // Raster emits M5 before arming and again after its last row. Vector modes
  // and coolant are emitted only when they differ from the preceding state.
  if (group.kind === 'raster' || mode !== state.mode || nextCoolant !== state.coolant) {
    appendPlannerStop(blocks);
  }
  state.mode = mode;
  state.coolant = nextCoolant;
}

export function appendPlannerStop(blocks: Block[]): void {
  const lastIndex = blocks.length - 1;
  const last = blocks[lastIndex];
  if (last !== undefined) blocks[lastIndex] = { ...last, stopAfter: true };
}
