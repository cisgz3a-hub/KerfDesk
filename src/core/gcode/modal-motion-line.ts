import { scanGcodeWords } from './word-scan';

export type GcodeMotionMode = 0 | 1 | 2 | 3;

export type ModalMotionLine = {
  readonly motion: GcodeMotionMode | null;
  readonly hasTarget: boolean;
  readonly isMotionContext: boolean;
  readonly isMotion: boolean;
};

/** Resolve explicit or inherited G0-G3 motion for one already-uncommented block. */
export function scanModalMotionLine(
  line: string,
  current: GcodeMotionMode | null,
): ModalMotionLine {
  let motion = current;
  let hasTarget = false;
  let hasAxisCommand = false;
  for (const word of scanGcodeWords(line)) {
    if (word.letter === 'G' && isMotionMode(word.value)) motion = word.value;
    else if (word.letter === 'G' && isMotionCancel(word.value)) motion = null;
    else if (word.letter === 'G' && isAxisCommand(word.value)) hasAxisCommand = true;
    else if (isMotionTargetWord(word.letter)) hasTarget = true;
  }
  const isMotionContext = motion !== null && !hasAxisCommand;
  return { motion, hasTarget, isMotionContext, isMotion: isMotionContext && hasTarget };
}

function isMotionMode(value: number): value is GcodeMotionMode {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isMotionCancel(value: number): boolean {
  return value === 80 || value === 38.2 || value === 38.3 || value === 38.4 || value === 38.5;
}

function isAxisCommand(value: number): boolean {
  return value === 10 || value === 28 || value === 30 || value === 43.1 || Math.trunc(value) === 92;
}

function isMotionTargetWord(letter: string): boolean {
  return (
    letter === 'X' ||
    letter === 'Y' ||
    letter === 'Z' ||
    letter === 'I' ||
    letter === 'J' ||
    letter === 'R'
  );
}
