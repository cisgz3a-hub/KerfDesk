export type LumaAdjustments = {
  readonly brightness?: number;
  readonly contrast?: number;
  readonly gamma?: number;
};

const BYTE_MAX = 255;

export function applyLumaAdjustments(input: Uint8Array, adjustments: LumaAdjustments): Uint8Array {
  const brightness = adjustments.brightness ?? 0;
  const contrast = adjustments.contrast ?? 0;
  const gamma = adjustments.gamma ?? 1;
  if (brightness === 0 && contrast === 0 && gamma === 1) return input;

  let out: Uint8Array = input;
  if (brightness !== 0) out = mapLuma(out, (v) => clampByte(v + brightness * 2.55));
  if (contrast !== 0) {
    const factor = 1 + contrast / 100;
    out = mapLuma(out, (v) => clampByte((v - 128) * factor + 128));
  }
  const g = Math.max(0.1, Math.min(5, gamma));
  if (g !== 1) {
    const invG = 1 / g;
    out = mapLuma(out, (v) => clampByte(Math.pow(Math.max(0, v / BYTE_MAX), invG) * BYTE_MAX));
  }
  return out;
}

function mapLuma(input: Uint8Array, transform: (v: number) => number): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = transform(input[i] ?? BYTE_MAX);
  return out;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(BYTE_MAX, Math.round(value)));
}
