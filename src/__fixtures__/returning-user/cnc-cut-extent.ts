// Where a CNC program cuts, read from its moves: the extent of every G1, G2 or
// G3 endpoint in X and Y. The CNC sidecars beside these golden projects were
// measured with this same reading on the release that saved each one.
export type CncCutExtent = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function codeOf(raw: string): string {
  return (raw.split(';')[0] ?? '').replace(/\([^)]*\)/g, '').toUpperCase();
}

export function cncCutExtent(gcode: string): CncCutExtent {
  const head = { x: 0, y: 0, motion: '0' };
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const raw of gcode.split('\n')) {
    const line = codeOf(raw);
    const motion = /\bG0?([0-3])(?![0-9])/.exec(line)?.[1];
    if (motion !== undefined) head.motion = motion;
    const x = /X(-?[\d.]+)/.exec(line)?.[1];
    const y = /Y(-?[\d.]+)/.exec(line)?.[1];
    if (x === undefined && y === undefined) continue;
    if (/\bG(?:53|92|10)\b/.test(line)) continue;
    head.x = x === undefined ? head.x : Number(x);
    head.y = y === undefined ? head.y : Number(y);
    if (head.motion === '0') continue;
    box.minX = Math.min(box.minX, head.x);
    box.minY = Math.min(box.minY, head.y);
    box.maxX = Math.max(box.maxX, head.x);
    box.maxY = Math.max(box.maxY, head.y);
  }
  const rounded = (value: number) => Math.round(value * 1000) / 1000;
  return {
    minX: rounded(box.minX),
    minY: rounded(box.minY),
    maxX: rounded(box.maxX),
    maxY: rounded(box.maxY),
  };
}
