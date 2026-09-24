// Resume transform 3 for Smoothieware and Marlin laser programs (ADR-364): the
// beam-off re-entry and the replay of GRBL's transform 2, written in the power
// commands of the program's own dialect (native-laser-resume-beam.ts).

import {
  applyNativeBeamLine,
  nativeBeamArmed,
  type BeamLineEffect,
  type NativeLaserBeam,
} from './native-laser-resume-beam';
import {
  applyMotionWords,
  formatNumber,
  movesInBurnMotion,
  restoreModalMotion,
  withPowerText,
  wordsForLine,
  type GcodeWord,
  type LaserResumeModalState,
} from './laser-resume-reentry';

export type NativeLaserResume = {
  readonly preamble: ReadonlyArray<string>;
  readonly tail: ReadonlyArray<string>;
};

const AXIS_LETTERS: ReadonlySet<string> = new Set(['X', 'Y', 'Z', 'A', 'B', 'C', 'I', 'J']);

/** Applies a line before the resume line to the beam the program holds. */
export function scanNativeBeamLine(beam: NativeLaserBeam, rawLine: string): void {
  applyNativeBeamLine(beam, rawLine, wordsForLine(rawLine));
}

export function nativeLaserResume(
  state: LaserResumeModalState,
  beam: NativeLaserBeam,
  originalTail: ReadonlyArray<string>,
): NativeLaserResume {
  const preamble = nativePreamble(state, beam);
  if (beam.dialect !== 'marlin-fan') {
    return { preamble, tail: replayNativeTail(state, beam, originalTail) };
  }
  const tail = restoreTailMotion(state, originalTail);
  const at = fanRestoreIndex(beam, tail);
  if (at < 0) return { preamble, tail };
  const restore = `M106 S${beam.power?.text ?? '0'}`;
  if (at === 0) return { preamble: [...preamble, restore], tail };
  return { preamble, tail: [...tail.slice(0, at), restore, ...tail.slice(at)] };
}

// The GRBL preamble's order: hard-off first, then air, the beam-off re-entry,
// the re-arm at zero power and the feed. Every line is one the dialect's own
// strategy writes.
function nativePreamble(state: LaserResumeModalState, beam: NativeLaserBeam): string[] {
  const smoothie = beam.dialect === 'smoothieware';
  return [
    '; KerfDesk resume preamble',
    // Manual fire holds the beam on whatever the motion does.
    ...(smoothie && beam.autoMode ? ['fire off'] : []),
    state.units,
    'G90',
    // Marlin programs select no work system and G94 is not a Marlin command.
    ...(smoothie ? [state.wcs, 'G94'] : beam.wcs === null ? [] : [beam.wcs]),
    ...hardOff(beam),
    ...(state.mist ? ['M7'] : []),
    ...(state.flood ? ['M8'] : []),
    ...reentryMove(state, beam),
    ...rearm(beam),
    ...feedLine(state, beam),
  ];
}

function hardOff(beam: NativeLaserBeam): string[] {
  if (beam.dialect === 'marlin-inline') return ['M5 I'];
  if (beam.dialect === 'marlin-fan') return ['M107'];
  // M221 applies at once, so it waits for queued motion like the strategy's.
  return beam.scale === null ? [] : ['M400', 'M221 S0'];
}

function reentryMove(state: LaserResumeModalState, beam: NativeLaserBeam): string[] {
  if (state.x === null && state.y === null) return [];
  const x = state.x === null ? '' : ` X${formatNumber(state.x)}`;
  const y = state.y === null ? '' : ` Y${formatNumber(state.y)}`;
  // The fan dialect writes no S words on motion; the others travel at S0.
  return [`G0${x}${y}${beam.dialect === 'marlin-fan' ? '' : ' S0'}`];
}

function rearm(beam: NativeLaserBeam): string[] {
  if (beam.dialect === 'marlin-inline') {
    return nativeBeamArmed(beam) ? [`${beam.inlineMode ?? 'M3'} I S0`] : [];
  }
  if (beam.dialect === 'marlin-fan' || beam.scale === null || beam.scale.value <= 0) return [];
  const proportional = beam.proportional === null ? '' : ` P${beam.proportional}`;
  return ['M400', `M221 S${beam.scale.text}${proportional}`];
}

// Marlin accepts F only on a command (a bare F is an unknown command unless
// the build enables GCODE_MOTION_MODES); Smoothieware runs a bare F as G1 F.
function feedLine(state: LaserResumeModalState, beam: NativeLaserBeam): string[] {
  if (state.feed === null) return [];
  const feed = `F${formatNumber(state.feed)}`;
  return [beam.dialect === 'smoothieware' ? feed : `G1 ${feed}`];
}

/** GRBL transform 2's replay in the dialect's power words: power stays at zero
 * until the program reaches a burn move, and the first burn move whose power
 * is modal states it. */
function replayNativeTail(
  state: LaserResumeModalState,
  scanned: NativeLaserBeam,
  originalTail: ReadonlyArray<string>,
): string[] {
  const replay: NativeReplay = {
    intended: { ...state },
    beam: { ...scanned },
    motionPending: true,
    physicalPower: 0,
  };
  return originalTail.map((rawLine) => replayNativeLine(replay, rawLine));
}

type NativeReplay = {
  readonly intended: LaserResumeModalState;
  readonly beam: NativeLaserBeam;
  motionPending: boolean;
  /** The power the controller holds for a move without its own S word. */
  physicalPower: number;
};

function replayNativeLine(replay: NativeReplay, rawLine: string): string {
  let line = rawLine;
  if (replay.motionPending) {
    const restored = restoreModalMotion(replay.intended, rawLine);
    line = restored.line;
    replay.motionPending = !restored.settled;
  }
  const words = wordsForLine(line);
  applyMotionWords(replay.intended, words);
  const effect = applyNativeBeamLine(replay.beam, line, words);
  const burnPower = replay.beam.power;
  if (
    burnPower !== null &&
    burnPower.value > 0 &&
    nativeBeamArmed(replay.beam) &&
    movesInBurnMotion(replay.intended, words, 3)
  ) {
    const restatesPower = effect.power === null && replay.physicalPower !== burnPower.value;
    replay.physicalPower = burnPower.value;
    return restatesPower ? withPowerText(line, burnPower.text) : line;
  }
  return replayDarkLine(replay, line, effect);
}

// A line that burns nothing leaves the power at zero: a power word above zero
// and an arm line are replayed at S0.
function replayDarkLine(replay: NativeReplay, line: string, effect: BeamLineEffect): string {
  replay.physicalPower = effect.power?.value ?? (effect.zeroes ? 0 : replay.physicalPower);
  if ((effect.power === null || effect.power.value <= 0) && !effect.arms) return line;
  replay.physicalPower = 0;
  return withPowerText(line, '0');
}

function restoreTailMotion(
  state: LaserResumeModalState,
  originalTail: ReadonlyArray<string>,
): string[] {
  const intended = { ...state };
  let motionPending = true;
  return originalTail.map((rawLine) => {
    if (!motionPending) return rawLine;
    const restored = restoreModalMotion(intended, rawLine);
    motionPending = !restored.settled;
    return restored.line;
  });
}

/** Where the fan power the program held goes back on: just before the first
 * move, so the beam is not lit while the head stands still, unless the program
 * sets the fan itself first. -1 when nothing is restored. */
function fanRestoreIndex(beam: NativeLaserBeam, tail: ReadonlyArray<string>): number {
  if ((beam.power?.value ?? 0) <= 0) return -1;
  for (let index = 0; index < tail.length; index += 1) {
    const words = wordsForLine(tail[index] ?? '');
    if (words.some(({ letter, value }) => letter === 'M' && (value === 106 || value === 107))) {
      return -1;
    }
    if (movesHead(words)) return index;
  }
  return -1;
}

// Marlin moves only on a G0-G3 command with a destination.
function movesHead(words: ReadonlyArray<GcodeWord>): boolean {
  const motion = words.find(({ letter }) => letter === 'G' || letter === 'M');
  return (
    motion?.letter === 'G' &&
    motion.value >= 0 &&
    motion.value <= 3 &&
    words.some(({ letter }) => AXIS_LETTERS.has(letter))
  );
}
