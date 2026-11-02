import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import type { PreparedOutput } from '../../io/gcode/prepare-output';

export type Burn = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export function advisoryMessages(prepared: PreparedOutput): ReadonlyArray<string> {
  if (!prepared.ok) throw new Error('output was refused');
  return (prepared.advisories ?? []).map((issue) => issue.message);
}

export function burnFrom(prepared: PreparedOutput): Burn {
  if (!prepared.ok) throw new Error('output was refused');
  return burnExtent(emitPreparedGcode(prepared).gcode);
}

// Every point a G1 move burns through: its start and its end.
function burnExtent(gcode: string): Burn {
  let x = 0;
  let y = 0;
  const burn = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const include = (px: number, py: number): void => {
    burn.minX = Math.min(burn.minX, px);
    burn.maxX = Math.max(burn.maxX, px);
    burn.minY = Math.min(burn.minY, py);
    burn.maxY = Math.max(burn.maxY, py);
  };
  for (const line of gcode.split('\n')) {
    const motion = /^G([01])\b/.exec(line)?.[1];
    if (motion === undefined) continue;
    const nextX = Number(/X(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? x);
    const nextY = Number(/Y(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? y);
    if (motion === '1') {
      include(x, y);
      include(nextX, nextY);
    }
    x = nextX;
    y = nextY;
  }
  if (!Number.isFinite(burn.minX)) throw new Error('no burn moves in the G-code');
  return burn;
}
