// Keyboard XY jog keys (LightBurn gap LBG-M07, ADR-483).
//
// LightBurn's Move window binds XY jog to Ctrl/Cmd + a bracket, with Alt for
// left/right and Shift for up/down, plus the numeric keypad while NumLock is
// on. The directions here are PHYSICAL, exactly as the jog pad's arrows
// (JogArrowGrid): up is away from the operator, and the device origin turns
// that into a machine delta through stepJogVector, never here.
//
// Bare arrow keys are NOT jog keys: they nudge the selected canvas object and
// one press must never also move the head (F104). With NumLock off the keypad
// sends ArrowUp/ArrowLeft/..., which therefore stay with the canvas; only the
// digit a NumLock-on keypad sends is read as a jog.

import type { PhysicalJogDirection } from './jog-control-policy';

type JogKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

type BracketChord = {
  readonly modifier: 'Alt' | 'Shift';
  // Matched by physical key: Shift turns '[' into '{', and Ctrl+Alt is AltGr
  // on many layouts, so event.key is not reliable for these chords.
  readonly code: 'BracketLeft' | 'BracketRight';
};

type KeyboardJogBinding = {
  readonly direction: PhysicalJogDirection;
  readonly numpadDigit: string;
  readonly chord: BracketChord | null;
};

const KEYBOARD_JOG_BINDINGS: ReadonlyArray<KeyboardJogBinding> = [
  {
    direction: { x: 0, y: 1 },
    numpadDigit: '8',
    chord: { modifier: 'Shift', code: 'BracketRight' },
  },
  {
    direction: { x: 0, y: -1 },
    numpadDigit: '2',
    chord: { modifier: 'Shift', code: 'BracketLeft' },
  },
  { direction: { x: -1, y: 0 }, numpadDigit: '4', chord: { modifier: 'Alt', code: 'BracketLeft' } },
  { direction: { x: 1, y: 0 }, numpadDigit: '6', chord: { modifier: 'Alt', code: 'BracketRight' } },
  { direction: { x: -1, y: 1 }, numpadDigit: '7', chord: null },
  { direction: { x: 1, y: 1 }, numpadDigit: '9', chord: null },
  { direction: { x: -1, y: -1 }, numpadDigit: '1', chord: null },
  { direction: { x: 1, y: -1 }, numpadDigit: '3', chord: null },
];

/** The physical jog direction a key press asks for, or null when it is not a jog key. */
export function keyboardJogDirection(event: JogKeyEvent): PhysicalJogDirection | null {
  const binding = KEYBOARD_JOG_BINDINGS.find(
    (entry) =>
      matchesNumpadDigit(event, entry.numpadDigit) ||
      (entry.chord !== null && matchesBracketChord(event, entry.chord)),
  );
  return binding?.direction ?? null;
}

/** Tooltip text naming the keys for one jog-pad arrow, e.g. `Ctrl+Shift+] or Numpad 8`. */
export function keyboardJogHint(direction: PhysicalJogDirection): string {
  const binding = KEYBOARD_JOG_BINDINGS.find(
    (entry) => entry.direction.x === direction.x && entry.direction.y === direction.y,
  );
  if (binding === undefined) return '';
  const numpad = `Numpad ${binding.numpadDigit}`;
  return binding.chord === null ? numpad : `${chordLabel(binding.chord)} or ${numpad}`;
}

function chordLabel(chord: BracketChord): string {
  return `Ctrl+${chord.modifier}+${chord.code === 'BracketLeft' ? '[' : ']'}`;
}

// NumLock on: the keypad sends the digit. NumLock off: it sends an arrow key,
// which the canvas nudge owns (F104). Numpad 5 (Clear) is not bound.
function matchesNumpadDigit(event: JogKeyEvent, digit: string): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return event.code === `Numpad${digit}` && event.key === digit;
}

// Ctrl or Cmd, plus exactly one of Alt/Option or Shift.
function matchesBracketChord(event: JogKeyEvent, chord: BracketChord): boolean {
  if (event.code !== chord.code || !(event.ctrlKey || event.metaKey)) return false;
  return chord.modifier === 'Alt'
    ? event.altKey && !event.shiftKey
    : event.shiftKey && !event.altKey;
}
