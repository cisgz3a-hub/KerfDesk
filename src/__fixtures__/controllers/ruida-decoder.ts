// ruida-decoder — test instrument that unswizzles and parses the .rd command
// stream this repo's encoder produces. Round-tripping through this decoder
// proves the encoder's INTERNAL consistency (geometry, power, speed, layer
// structure survive encode→decode); it does NOT prove real-Ruida acceptance.

import {
  decodeCoord35,
  decodePower14,
  unswizzleBytes,
} from '../../core/controllers/ruida';

export type RdDecodedEvent =
  | { readonly kind: 'stream-start' }
  | { readonly kind: 'block-end' }
  | { readonly kind: 'file-end' }
  | { readonly kind: 'move'; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'cut'; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'layer-speed'; readonly layer: number; readonly mmPerMin: number }
  | { readonly kind: 'layer-min-power'; readonly layer: number; readonly percent: number }
  | { readonly kind: 'layer-max-power'; readonly layer: number; readonly percent: number }
  | { readonly kind: 'layer-color'; readonly layer: number; readonly packed: number }
  | { readonly kind: 'select-layer'; readonly layer: number }
  | { readonly kind: 'job-bounds'; readonly tag: number; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'unknown'; readonly byte: number };

type Decoded = { readonly event: RdDecodedEvent; readonly advance: number };

export function decodeRdStream(bytes: Uint8Array): ReadonlyArray<RdDecodedEvent> {
  const raw = unswizzleBytes(bytes);
  const events: RdDecodedEvent[] = [];
  let i = 0;
  while (i < raw.length) {
    const decoded =
      decodeMotion(raw, i) ??
      decodeLayerSetting(raw, i) ??
      decodeFraming(raw, i) ??
      ({ event: { kind: 'unknown', byte: raw[i] ?? 0 }, advance: 1 } satisfies Decoded);
    events.push(decoded.event);
    i += decoded.advance;
  }
  return events;
}

function coordAt(raw: Uint8Array, at: number): number {
  return decodeCoord35([...raw.slice(at, at + 5)]);
}

function mmAt(raw: Uint8Array, at: number): number {
  return coordAt(raw, at) / 1000;
}

function decodeMotion(raw: Uint8Array, i: number): Decoded | null {
  const op = raw[i] ?? 0;
  if (op !== 0x88 && op !== 0xa8) return null;
  return {
    event: { kind: op === 0x88 ? 'move' : 'cut', xMm: mmAt(raw, i + 1), yMm: mmAt(raw, i + 6) },
    advance: 11,
  };
}

function decodeLayerSetting(raw: Uint8Array, i: number): Decoded | null {
  const op = raw[i] ?? 0;
  const sub = raw[i + 1] ?? 0;
  const layer = raw[i + 2] ?? 0;
  if (op === 0xc9 && sub === 0x04) {
    const umPerSec = coordAt(raw, i + 3);
    return { event: { kind: 'layer-speed', layer, mmPerMin: (umPerSec / 1000) * 60 }, advance: 8 };
  }
  if (op === 0xc6) return decodePowerSetting(raw, i, sub, layer);
  if (op === 0xca && sub === 0x06) {
    return { event: { kind: 'layer-color', layer, packed: coordAt(raw, i + 3) }, advance: 8 };
  }
  if (op === 0xca && sub === 0x02) {
    return { event: { kind: 'select-layer', layer }, advance: 3 };
  }
  return null;
}

function decodePowerSetting(raw: Uint8Array, i: number, sub: number, layer: number): Decoded | null {
  if (sub !== 0x31 && sub !== 0x32) return null;
  return {
    event: {
      kind: sub === 0x31 ? 'layer-min-power' : 'layer-max-power',
      layer,
      percent: decodePower14([raw[i + 3] ?? 0, raw[i + 4] ?? 0]),
    },
    advance: 5,
  };
}

function decodeFraming(raw: Uint8Array, i: number): Decoded | null {
  const op = raw[i] ?? 0;
  if (op === 0xe7) {
    const tag = raw[i + 1] ?? 0;
    return {
      event: { kind: 'job-bounds', tag, xMm: mmAt(raw, i + 2), yMm: mmAt(raw, i + 7) },
      advance: 12,
    };
  }
  if (op === 0xd8 && raw[i + 1] === 0x12) return { event: { kind: 'stream-start' }, advance: 2 };
  if (op === 0xeb) return { event: { kind: 'block-end' }, advance: 1 };
  if (op === 0xd7) return { event: { kind: 'file-end' }, advance: 1 };
  return null;
}
