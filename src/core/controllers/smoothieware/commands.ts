// Smoothieware command vocabulary. Realtime `?` / `!` / `~` / Ctrl-X are
// supported like GRBL; there is no `$J` jog protocol, `$$` settings dump,
// `$X` unlock, or `$SLP` sleep. Halt recovery is `M999`.

import type { FrameBounds } from '../controller-driver';
import type { JogParams } from '../grbl/commands';

/** Home all configured axes (Smoothie's homing cycle). */
export const SMOOTHIE_CMD_HOME = 'G28.2';

/** Clear the halted (kill/limit) state. */
export const SMOOTHIE_CMD_UNLOCK = 'M999';

export const SMOOTHIE_CMD_POSITION = 'M114';
export const SMOOTHIE_CMD_FIRMWARE_INFO = 'M115';
export const SMOOTHIE_CMD_VERSION = 'version';

/** Beam-off cleanup after stop: M5 (laser off) then M9 (air assist off). */
export const SMOOTHIE_STOP_LASER_LINES: ReadonlyArray<string> = ['M5', 'M9'];

const fmt = (n: number): string => n.toFixed(3);
const fmtFeed = (feed: number): number => Math.max(1, Math.round(feed));

/** Relative jog without a native jog protocol (same shape as Marlin). */
export function buildSmoothieJogCommand(params: JogParams): string {
  const axes: string[] = [];
  if (typeof params.dx === 'number' && params.dx !== 0) axes.push(`X${fmt(params.dx)}`);
  if (typeof params.dy === 'number' && params.dy !== 0) axes.push(`Y${fmt(params.dy)}`);
  if (typeof params.dz === 'number' && params.dz !== 0) axes.push(`Z${fmt(params.dz)}`);
  const move = `G0 ${axes.join(' ')} F${fmtFeed(params.feed)}`.replace('  ', ' ');
  if (params.relative === false) return `G90\n${move}`;
  return `G91\n${move}\nG90`;
}

/** Framing = absolute G0 perimeter (G90 lead line, then five legs). */
export function buildSmoothieFrameLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
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
