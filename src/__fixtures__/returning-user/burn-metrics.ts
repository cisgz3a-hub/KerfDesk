// What a G-code file burns, read from its moves: every G1, G2 or G3 with power.
// The sidecars beside these golden projects were measured with this same reading
// on the release that saved each one.
export type BurnMetrics = {
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly length: number;
  readonly dose: number;
};

type Head = { x: number; y: number; power: number; motion: string };

export function burnMetrics(gcode: string): BurnMetrics {
  const head: Head = { x: 0, y: 0, power: 0, motion: '0' };
  let length = 0;
  let dose = 0;
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const line of gcode.split('\n')) {
    const move = nextMove(line, head);
    if (move === null) continue;
    const step = Math.hypot(move.x - head.x, move.y - head.y);
    if (head.motion !== '0' && head.power > 0 && step > 0) {
      length += step;
      dose += step * head.power;
      box.minX = Math.min(box.minX, head.x, move.x);
      box.maxX = Math.max(box.maxX, head.x, move.x);
      box.minY = Math.min(box.minY, head.y, move.y);
      box.maxY = Math.max(box.maxY, head.y, move.y);
    }
    head.x = move.x;
    head.y = move.y;
  }
  return {
    width: rounded(box.maxX - box.minX),
    height: rounded(box.maxY - box.minY),
    minX: rounded(box.minX),
    minY: rounded(box.minY),
    length: rounded(length),
    dose: rounded(dose),
  };
}

// Modal words stay in force, and a raster row's line can be just "X60.3S200".
function nextMove(line: string, head: Head): { readonly x: number; readonly y: number } | null {
  if (line.startsWith(';')) return null;
  head.motion = /^G([0123])(?!\d)/.exec(line)?.[1] ?? head.motion;
  const power = /S(\d+(?:\.\d+)?)/.exec(line)?.[1];
  if (power !== undefined) head.power = Number(power);
  if (!/^(?:G[0123](?!\d)|[XY]-?\d)/.test(line) || !/[XY]-?\d/.test(line)) return null;
  return {
    x: Number(/X(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? head.x),
    y: Number(/Y(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? head.y),
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
