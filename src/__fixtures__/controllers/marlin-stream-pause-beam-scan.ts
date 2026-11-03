// The Marlin stream-side Pause beam decision as main computed it before
// performance audit S1-P1-1 (ADR-676 Amendment 3): each call walks the
// program. Kept verbatim as the oracle the indexed decision in
// core/controllers/marlin/stream-pause-beam.ts must match at every position.
import type { StreamPauseBeamPlan } from '../../core/controllers/controller-driver';
import {
  stripComments,
  withPowerText,
  wordsForLine,
  type GcodeWord,
} from '../../core/controllers/grbl/laser-resume-reentry';
import {
  applyNativeBeamLine,
  createNativeLaserBeam,
  nativeBeamArmed,
  type PowerWord,
} from '../../core/controllers/grbl/native-laser-resume-beam';

type HeldInlineBeam = {
  /** The inline mode the program selected; M5 I leaves it. */
  readonly mode: 'M3' | 'M4';
  /** The inline output is enabled (M3 I / M4 I), so moves burn. */
  readonly armed: boolean;
  /** The power a burn move without its own S word runs at. */
  readonly power: PowerWord | null;
};

// M106 without S runs the fan at full speed (M106_M107.cpp: dspeed = 255).
const FULL_FAN: PowerWord = { value: 255, text: '255' };
const MOVE_AXES: ReadonlySet<string> = new Set(['X', 'Y', 'Z', 'I', 'J']);

/** The beam handling of a Marlin stream-side Pause at `queueIndex`, the
 * first stream line not yet sent. */
export function scannedMarlinStreamPauseBeam(
  streamLines: ReadonlyArray<string>,
  queueIndex: number,
): StreamPauseBeamPlan {
  const sent = Math.max(0, Math.min(queueIndex, streamLines.length));
  const fan = heldFanPower(streamLines, sent);
  const inline = heldInlineBeam(streamLines, sent);
  const resumes = sent < streamLines.length;
  return {
    offLines: [...(fan === null ? [] : ['M107']), ...(inline === null ? [] : ['M5 I'])],
    restoreLines: resumes ? [...fanRestore(fan, streamLines, sent), ...inlineRearm(inline)] : [],
    restatedLine: resumes ? restatedBurnMove(inline, streamLines, sent) : null,
  };
}

/** Every beam-off a Pause could need when the stream has gone no further back
 * than `queueIndex`, but may be anywhere past it: a worker holds the refill, and
 * the lines it forwarded have not been read yet. The stop must not wait for them
 * (rolling audit v9 R1-P2-1, ADR-676 Amendment 2). A beam-off with nothing to
 * switch off costs one `ok`, and Resume re-arms only what the final position
 * held, so a line too many is harmless. */
export function scannedMarlinStreamPauseOffLinesFrom(
  streamLines: ReadonlyArray<string>,
  queueIndex: number,
): ReadonlyArray<string> {
  const sent = Math.max(0, Math.min(queueIndex, streamLines.length));
  const fan = heldFanPower(streamLines, sent) !== null || someLineFrom(streamLines, sent, litsFan);
  const inline =
    heldInlineBeam(streamLines, sent) !== null || someLineFrom(streamLines, sent, armsInline);
  return [...(fan ? ['M107'] : []), ...(inline ? ['M5 I'] : [])];
}

function someLineFrom(
  lines: ReadonlyArray<string>,
  from: number,
  matches: (line: string) => boolean,
): boolean {
  for (let index = from; index < lines.length; index += 1) {
    if (matches(lines[index] ?? '')) return true;
  }
  return false;
}

function litsFan(line: string): boolean {
  if (!/m/i.test(line)) return false;
  const words = wordsForLine(line);
  const command = marlinCommand(words);
  return (
    command?.letter === 'M' && command.value === 106 && (lastWord(words, 'S') ?? FULL_FAN).value > 0
  );
}

function armsInline(line: string): boolean {
  if (!isInlineModeSwitch(line)) return false;
  return marlinCommand(wordsForLine(line))?.value !== 5;
}

/** The fan speed the sent lines left, when it is above zero. */
function heldFanPower(lines: ReadonlyArray<string>, sent: number): PowerWord | null {
  for (let index = sent - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (!/m/i.test(line)) continue;
    const words = wordsForLine(line);
    const command = marlinCommand(words);
    if (command?.letter !== 'M') continue;
    if (command.value === 107) return null;
    if (command.value !== 106) continue;
    const power = lastWord(words, 'S') ?? FULL_FAN;
    return power.value > 0 ? power : null;
  }
  return null;
}

/** The inline cutter the sent lines left, or null when inline mode is off.
 * Only the lines since the last inline mode switch (M3 I, M4 I, M5 I) matter,
 * so a long job is scanned from there. */
function heldInlineBeam(lines: ReadonlyArray<string>, sent: number): HeldInlineBeam | null {
  let start = sent - 1;
  while (start >= 0 && !isInlineModeSwitch(lines[start] ?? '')) start -= 1;
  if (start < 0) return null;
  const beam = createNativeLaserBeam('marlin-inline');
  for (let index = start; index < sent; index += 1) {
    const line = lines[index] ?? '';
    applyNativeBeamLine(beam, line, wordsForLine(line));
  }
  if (beam.inlineMode === null) return null;
  return { mode: beam.inlineMode, armed: nativeBeamArmed(beam), power: beam.power };
}

function isInlineModeSwitch(line: string): boolean {
  if (!/m/i.test(line)) return false;
  const command = marlinCommand(wordsForLine(line));
  if (command?.letter !== 'M' || ![3, 4, 5].includes(command.value)) return false;
  return /\bI(?=\s|$)/i.test(stripComments(line));
}

/** `M106 S<held>` when the next line is the move it must light, unless the
 * program sets the fan itself first. When other lines come before that move
 * the fan is not restored early: it would light the standing head while they
 * run, and the program's own next M106 brings the power back. */
function fanRestore(
  fan: PowerWord | null,
  lines: ReadonlyArray<string>,
  sent: number,
): ReadonlyArray<string> {
  if (fan === null) return [];
  const next = wordsForLine(lines[sent] ?? '');
  return movesHead(next) ? [`M106 S${fan.text}`] : [];
}

function inlineRearm(inline: HeldInlineBeam | null): ReadonlyArray<string> {
  return inline?.armed === true ? [`${inline.mode} I S0`] : [];
}

/** After `M3 I S0` the inline power is 0, so the first burn move that relies
 * on the held S gets it restated. Scanning stops at the first line that sets
 * the power itself: G0 (zeroes it), M3/M4/M5, or a move with its own S. */
function restatedBurnMove(
  inline: HeldInlineBeam | null,
  lines: ReadonlyArray<string>,
  sent: number,
): StreamPauseBeamPlan['restatedLine'] {
  const power = inline?.armed === true ? inline.power : null;
  if (power === null || power.value <= 0) return null;
  for (let index = sent; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const step = burnScanStep(wordsForLine(line));
    if (step === 'stop') return null;
    if (step === 'restate') {
      const restated = withPowerText(line.replace(/\n$/, ''), power.text);
      return { offset: index - sent, line: `${restated}\n` };
    }
  }
  return null;
}

/** What one line after the pause point means for the held inline power. */
function burnScanStep(words: ReadonlyArray<GcodeWord>): 'skip' | 'stop' | 'restate' {
  const command = marlinCommand(words);
  if (command === null) return 'skip';
  if (command.letter === 'M') return [3, 4, 5].includes(command.value) ? 'stop' : 'skip';
  if (command.value > 3) return 'skip';
  if (command.value === 0 || lastWord(words, 'S') !== null) return 'stop';
  return movesHead(words) ? 'restate' : 'skip';
}

// Marlin moves only on a G0-G3 command with a destination.
function movesHead(words: ReadonlyArray<GcodeWord>): boolean {
  const command = marlinCommand(words);
  return (
    command?.letter === 'G' &&
    command.value >= 0 &&
    command.value <= 3 &&
    words.some(({ letter }) => MOVE_AXES.has(letter))
  );
}

// Marlin runs one command per line: the first G or M word; the rest are its
// parameters.
function marlinCommand(words: ReadonlyArray<GcodeWord>): GcodeWord | null {
  return words.find(({ letter }) => letter === 'G' || letter === 'M') ?? null;
}

function lastWord(words: ReadonlyArray<GcodeWord>, letter: string): PowerWord | null {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word?.letter === letter) return word;
  }
  return null;
}
