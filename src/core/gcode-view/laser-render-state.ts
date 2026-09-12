import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import type { GcodeWordMatch } from '../gcode';
import type { BuildRenderModelOptions } from './render-model-types';
import type { RenderModal } from './render-model-words';

export type LaserRenderState = {
  readonly machineKind: BuildRenderModelOptions['machineKind'];
  readonly powerControl: BuildRenderModelOptions['laserPowerControl'];
  intentionalOffLine: boolean;
  fanPower: number;
};

export function createLaserRenderState(options: BuildRenderModelOptions): LaserRenderState {
  return {
    machineKind: options.machineKind,
    powerControl: options.laserPowerControl,
    intentionalOffLine: false,
    fanPower: 0,
  };
}

export function updateLaserRenderState(
  state: LaserRenderState,
  words: ReadonlyArray<GcodeWordMatch>,
  raw: string,
): void {
  state.intentionalOffLine = raw.includes(INTENTIONAL_LASER_OFF_MOTION_COMMENT);
  if (state.powerControl !== 'fan') return;
  let power = 255;
  for (const word of words) if (word.letter === 'S') power = word.value;
  for (const word of words) {
    if (word.letter !== 'M') continue;
    if (word.value === 106) state.fanPower = power;
    if (word.value === 107) state.fanPower = 0;
  }
}

export function isLaserOffFeed(state: LaserRenderState, modal: RenderModal): boolean {
  if (state.machineKind === 'laser') {
    return state.powerControl === 'fan'
      ? state.fanPower <= 0
      : modal.power <= 0 || modal.spindleMode === 'off';
  }
  // A generated marker is evidence about this line only. A generic imported
  // S0/M5 program may be CNC, where tool contact remains geometric.
  return state.machineKind === undefined && state.intentionalOffLine && modal.power <= 0;
}

export function renderedPower(state: LaserRenderState, modal: RenderModal): number {
  return state.machineKind === 'laser' && state.powerControl === 'fan'
    ? state.fanPower
    : modal.power;
}
