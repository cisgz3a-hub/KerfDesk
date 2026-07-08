// Marlin command vocabulary for laser rigs. No realtime bytes exist on this
// firmware: everything is a queued G-code/M-code line acked with `ok`.

import type { FrameBounds } from '../controller-driver';
import { assertJogHasAxis, type JogParams } from '../grbl/commands';

/** Home X/Y only — plain G28 also homes Z, which on a laser conversion
 *  without a Z endstop would crash the head into the bed. */
export const MARLIN_CMD_HOME_XY = 'G28 X Y';

/** M400 blocks until every buffered move has finished, then acks — the exact
 *  semantics the settle-marker pattern needs (GRBL uses a G4 dwell). */
export const MARLIN_CMD_SETTLE = 'M400';

/** Beam-off cleanup after stop: M5 covers LASER_FEATURE (inline) builds,
 *  M107 covers fan-mosfet wiring. Harmless where unsupported. */
export const MARLIN_STOP_LASER_LINES: ReadonlyArray<string> = ['M5', 'M107'];

/** Queued position query; replies `X:.. Y:.. Z:.. E:.. Count ..` then ok. */
export const MARLIN_CMD_POSITION = 'M114';

export const MARLIN_CMD_FIRMWARE_INFO = 'M115';
export const MARLIN_CMD_SETTINGS_DUMP = 'M503';
export const MARLIN_CMD_TEMPERATURES = 'M105';
export const MARLIN_CMD_EMERGENCY_STOP = 'M112';

const fmt = (n: number): string => n.toFixed(3);
const fmtFeed = (feed: number): number => Math.max(1, Math.round(feed));

/** Relative jog without a native jog protocol: assert mm units, switch to
 *  relative mode, move, switch back. Multi-line payload — each line is acked
 *  individually. G21 leads every jog because a G20 left behind by a console
 *  command or an imported job would otherwise scale the move 25.4× (audit
 *  F10) — the GRBL builder asserts units inside `$J=` the same way. */
export function buildMarlinJogCommand(params: JogParams): string {
  // Zero deltas are dropped in relative mode only — in absolute mode X0/Y0
  // is a real destination (dropping it would keep the previous coordinate).
  const absolute = params.relative === false;
  const includeAxis = (value: number | undefined): value is number =>
    typeof value === 'number' && (absolute || value !== 0);
  assertJogHasAxis(params);
  const axes: string[] = [];
  if (includeAxis(params.dx)) axes.push(`X${fmt(params.dx)}`);
  if (includeAxis(params.dy)) axes.push(`Y${fmt(params.dy)}`);
  if (includeAxis(params.dz)) axes.push(`Z${fmt(params.dz)}`);
  const move = `G0 ${axes.join(' ')} F${fmtFeed(params.feed)}`.replace('  ', ' ');
  if (absolute) return `G21\nG90\n${move}`;
  return `G21\nG91\n${move}\nG90`;
}

/** Framing = absolute G0 perimeter (G21+G90 lead lines, then five legs). */
export function buildMarlinFrameLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  const f = fmtFeed(feed);
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ];
  return ['G21\n', 'G90\n', ...corners.map((c) => `G0 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`)];
}
