import { scanCompleteGcodeWords, type GcodeWordMatch } from '../gcode';
import type { LaserRenderState } from './laser-render-state';
import type { RenderModal, WordAccounting } from './render-model-words';

/** Marlin's standalone I flag is valid only on laser mode commands. Keep
 * arbitrary trailing text subject to the shared scanner's strict validation. */
export function scanControllerRenderWords(line: string): ReadonlyArray<GcodeWordMatch> | null {
  const words = scanCompleteGcodeWords(line);
  if (words !== null || !/^M[345]\s/i.test(line)) return words;
  return scanCompleteGcodeWords(line.replace(/\bI(?=\s|$)/gi, ''));
}

export function isNativeLaserConsoleLine(state: LaserRenderState, line: string): boolean {
  // Pinned Smoothieware V1 lower-case shell command, not general G-code.
  return isSmoothiewareLaser(state) && line === 'fire off';
}

type NativeWordContext = {
  readonly modal: RenderModal;
  readonly line: number;
  readonly accounting: WordAccounting;
};

export function nativeLaserMotionWords(
  state: LaserRenderState,
  words: ReadonlyArray<GcodeWordMatch>,
  context: NativeWordContext,
): ReadonlyArray<GcodeWordMatch> {
  if (!isSmoothiewareLaser(state) || !words.some(isM221)) return words;
  // Smoothieware V1 Laser.cpp: M221 S is a percent scale; P1 disables
  // proportional power and P0 enables it. Neither overwrites motion S.
  for (const word of words) {
    if (word.letter === 'S') state.smoothiePowerScale = word.value / 100;
    if (word.letter === 'P') state.smoothieMode = word.value > 0 ? 'constant' : 'dynamic';
  }
  context.accounting.pushEvent(
    state.smoothiePowerScale > 0
      ? {
          kind: 'spindle-on',
          line: context.line,
          mode: state.smoothieMode,
          power: context.modal.power * state.smoothiePowerScale,
        }
      : { kind: 'spindle-off', line: context.line },
  );
  // M221 executes immediately. The emitter supplies explicit M400 boundaries;
  // do not invent another planner synchronization for the percent change.
  return words.filter((word) => !isM221(word) && !['S', 'P', 'R'].includes(word.letter));
}

function isM221(word: GcodeWordMatch): boolean {
  return word.letter === 'M' && word.value === 221;
}

function isSmoothiewareLaser(state: LaserRenderState): boolean {
  return state.machineKind === 'laser' && state.powerControl === 'smoothieware';
}
