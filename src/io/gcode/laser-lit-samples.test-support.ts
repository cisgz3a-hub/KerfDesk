// Where a GRBL program's beam burns, read from the G-code text alone, so a
// laser lead test judges the output, not the compiler's own model of it.

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';

/** Points every 0.05 mm along every lit feed move (G1/G2/G3 with the beam on
 * and S above zero) of GRBL output, in scene coordinates. `offset`: the
 * prepared job's origin offset, undone first. */
export function litSamples(
  gcode: string,
  device: DeviceProfile,
  offset: Vec2 = { x: 0, y: 0 },
): Vec2[] {
  const samples: Vec2[] = [];
  const state = { at: { x: 0, y: 0 } as Vec2, motion: 0, power: 0, beam: false };
  for (const raw of gcode.split('\n')) {
    const words = readWords(raw, state);
    state.power = words.get('S') ?? state.power;
    if (!words.has('X') && !words.has('Y')) continue;
    const to = { x: words.get('X') ?? state.at.x, y: words.get('Y') ?? state.at.y };
    if (state.motion !== 0 && state.beam && state.power > 0)
      samples.push(...sampleMove(state.at, to, state.motion, words));
    state.at = to;
  }
  return samples.map((point) =>
    toSceneCoords({ x: point.x - offset.x, y: point.y - offset.y }, device),
  );
}

/** The line's axis and parameter words; G0-G3 and M3/M4/M5 update `state`. */
function readWords(raw: string, state: { motion: number; beam: boolean }): Map<string, number> {
  const line = raw
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  const words = new Map<string, number>();
  for (const [, letter = '', value] of line.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)) {
    const code = Number(value);
    if (letter === 'G') {
      if (code <= 3) state.motion = code;
    } else if (letter === 'M') spindle(code, state);
    else words.set(letter, code);
  }
  return words;
}

function spindle(code: number, state: { beam: boolean }): void {
  if (code === 3 || code === 4) state.beam = true;
  else if (code === 5) state.beam = false;
}

function sampleMove(from: Vec2, to: Vec2, motion: number, words: Map<string, number>): Vec2[] {
  if (motion === 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.05));
    return Array.from({ length: steps + 1 }, (_, step) => ({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    }));
  }
  const center = { x: from.x + (words.get('I') ?? 0), y: from.y + (words.get('J') ?? 0) };
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  let sweep = Math.atan2(to.y - center.y, to.x - center.x) - start;
  if (motion === 2 && sweep >= 0) sweep -= 2 * Math.PI;
  if (motion === 3 && sweep <= 0) sweep += 2 * Math.PI;
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) * radius) / 0.05));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const angle = start + (sweep * step) / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}
