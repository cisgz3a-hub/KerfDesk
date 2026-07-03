// Marlin command vocabulary for laser rigs. No realtime bytes exist on this
// firmware: everything is a queued G-code/M-code line acked with `ok`.

import type { FrameBounds } from '../controller-driver';
import type { JogParams } from '../grbl/commands';

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

/** Relative jog without a native jog protocol: switch to relative mode, move,
 *  switch back. Multi-line payload — each line is acked individually. */
export function buildMarlinJogCommand(params: JogParams): string {
  const axes: string[] = [];
  if (typeof params.dx === 'number' && params.dx !== 0) axes.push(`X${fmt(params.dx)}`);
  if (typeof params.dy === 'number' && params.dy !== 0) axes.push(`Y${fmt(params.dy)}`);
  if (typeof params.dz === 'number' && params.dz !== 0) axes.push(`Z${fmt(params.dz)}`);
  const move = `G0 ${axes.join(' ')} F${fmtFeed(params.feed)}`.replace('  ', ' ');
  if (params.relative === false) return `G90\n${move}`;
  return `G91\n${move}\nG90`;
}

/** Framing = absolute G0 perimeter (G90 lead line, then five legs). */
export function buildMarlinFrameLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  const f = fmtFeed(feed);
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ];
  return ['G90\n', ...corners.map((c) => `G0 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`)];
}
