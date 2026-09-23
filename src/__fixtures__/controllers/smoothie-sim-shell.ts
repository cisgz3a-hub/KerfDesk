// Smoothieware V1 command-dispatch model for the Smoothie simulator: which
// lines the SimpleShell answers instead of GcodeDispatch, what they print, and
// what G28/G28.x/$H mean in each dialect. Every rule below follows upstream
// edge source, so the simulator is an oracle for the driver rather than an
// echo of it:
// - GcodeDispatch::on_console_line_received ignores lines that start with `$`
//   or a lowercase letter; the shell owns them and prints `ok` only for $G,
//   $#, $H, $J -r, and $X while halted. Unknown lowercase words print
//   `error:Unsupported command - <word>`; unknown `$` letters print
//   `error:Invalid statement`.
//   https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/communication/GcodeDispatch.cpp
//   https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/utils/simpleshell/SimpleShell.cpp
// - Endstops::on_gcode_received: G28 homes in Reprap mode and parks in grbl
//   mode; G28.2 homes in grbl mode and parks otherwise; G28.1 stores the park
//   point (saved_position defaults to machine 0,0).
//   https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/tools/endstops/Endstops.cpp
// - Kernel.cpp: grbl_mode defaults to true only in the CNC build.
//   https://github.com/Smoothieware/Smoothieware/blob/edge/src/libs/Kernel.cpp

export type SmoothieReferenceEffect = 'home' | 'park' | 'save-park' | null;

/** What a G28-family line or `$H` does on this dialect (null: not a reference line). */
export function smoothieReferenceEffect(line: string, grblMode: boolean): SmoothieReferenceEffect {
  const trimmed = line.trim();
  // SimpleShell `$H` issues G28.2 in grbl mode and G28 otherwise: always a homing cycle.
  if (trimmed === '$H') return 'home';
  const match = /^G28(?:\.(\d+))?(?![\d.])/i.exec(trimmed);
  if (match === null) return null;
  const subcode = Number(match[1] ?? '0');
  if (subcode === 0) return grblMode ? 'park' : 'home';
  if (subcode === 1) return 'save-park';
  if (subcode === 2) return grblMode ? 'home' : 'park';
  return null;
}

export type SmoothieShellContext = {
  readonly halted: boolean;
};

export type SmoothieShellReply = {
  /** Lines printed, in order. `ok` appears only where upstream prints it. */
  readonly lines: ReadonlyArray<string>;
  readonly clearsHalt: boolean;
};

const MODAL_STATE_LINE = '[G0 G54 G17 G21 G90 G94 M0 M5 M9 T0 F4000.0000 S0.8000]';
const KNOWN_TEXT_COMMANDS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['help', ['Commands:', 'version', 'mem [-v]', 'ls [-s] [folder]']],
  ['mem', ['Unused Heap: 2048 bytes', 'Used Heap Size: 30720']],
  ['config-get', ['sd: laser_module_maximum_s_value is set to 1']],
]);
// Commands the Player module owns; the shell prints nothing for them.
const PLAYER_COMMANDS: ReadonlySet<string> = new Set([
  'play',
  'progress',
  'abort',
  'suspend',
  'resume',
]);

/**
 * The shell's reply to a `$` or lowercase line, or null when the line is not a
 * shell line (GcodeDispatch owns it). `$H` and `fire ...` also return null:
 * the caller runs the homing cycle (printing its `ok` once the cycle ends) and
 * the Laser module owns `fire`.
 */
export function smoothieShellReply(
  line: string,
  context: SmoothieShellContext,
): SmoothieShellReply | null {
  const first = line[0];
  if (first === undefined) return null;
  // A bare `$` is too short for the shell and GcodeDispatch ignores it: silence.
  if (first === '$') return line.length >= 2 ? dollarReply(line, context) : reply([]);
  if (!/[a-z]/.test(first)) return null;
  const word = line.split(/\s+/, 1)[0] ?? '';
  if (word === 'fire') return null;
  // A lowercase `ok...` is taken for an echo and ignored entirely.
  if (word.startsWith('ok') || PLAYER_COMMANDS.has(word)) return reply([]);
  if (word === 'version') {
    // version_command: the build line, then "%d axis". No ok follows.
    return reply([
      'Build version: edge-abc123, Build date: Jan 1 2024 00:00:00, MCU: LPC1769, System Clock: 120MHz',
      '5 axis',
    ]);
  }
  const text = KNOWN_TEXT_COMMANDS.get(word);
  if (text !== undefined) return reply(text);
  return reply([`error:Unsupported command - ${word}`]);
}

function dollarReply(line: string, context: SmoothieShellContext): SmoothieShellReply | null {
  // Case-sensitive, like upstream: `$g` is an invalid statement.
  switch (line.charAt(1)) {
    case 'G':
      return reply([MODAL_STATE_LINE, 'ok']);
    case '#':
      return reply(['[G54:0.0000,0.0000,0.0000]', '[G92:0.0000,0.0000,0.0000]', 'ok']);
    case 'I':
      // Smoopi's state query (`get state`): the modal state line with no ok.
      return reply([MODAL_STATE_LINE]);
    case 'X':
      // Only a halted machine is answered; otherwise $X prints nothing at all.
      return context.halted
        ? { lines: ['[Caution: Unlocked]', 'ok'], clearsHalt: true }
        : reply([]);
    case 'H':
      return null;
    case 'S':
      // switch_command prints the named switch states and no ok.
      return reply([]);
    case 'J':
      // jog() queues the move and prints ok only for `-r` (motion not modelled).
      return reply(/\s-r(?:\s|$)/i.test(line) ? ['ok'] : []);
    default:
      return reply(['error:Invalid statement']);
  }
}

function reply(lines: ReadonlyArray<string>): SmoothieShellReply {
  return { lines, clearsHalt: false };
}
