// Per-colour operation power for a colour-layer trace (ADR-402).
//
// Darker colours should burn darker, so each colour's power follows its
// darkness D = 1 - L, with L the OKLab lightness (0 black .. 1 white) and P the
// operation's power as created (the operator's layer default):
//   - cut-out: every area is burned once, by its own colour's operation, so
//       power_i = P * max(D_i / D_max, 0.25)
//     The darkest colour keeps P; lighter colours scale down with darkness,
//     never below a quarter of P so a pale colour still marks.
//   - stacked: an area is burned by its own operation AND every lighter one
//     stacked below it, so each operation adds only its darkness step:
//       power_i = P * max((D_i - D_prev) / D_max, 0.1)
//     where D_prev is the next lighter colour's darkness (0 for the lightest).
//     The doses then sum to P * D_i / D_max, the cut-out rule's target; the
//     10 % floor keeps near-equal tones from getting a zero-power operation.
// Powers are rounded to 0.1 %. Pure core.

import type { Layer, SceneObject } from '../scene';
import type { ColourLayerOutput } from './colour-layer-options';
import { hexOkLightness } from './colour-oklab';

const CUT_OUT_MIN_FRACTION = 0.25;
const STACKED_MIN_FRACTION = 0.1;

/** Power (0..100) for each colour, keyed by lowercase #rrggbb. */
export function colourLayerPowers(
  colours: ReadonlyArray<string>,
  basePower: number,
  output: ColourLayerOutput,
): Map<string, number> {
  const entries = [...new Set(colours.map((c) => c.toLowerCase()))].map((color) => ({
    color,
    darkness: Math.max(0, 1 - hexOkLightness(color)),
  }));
  const powers = new Map<string, number>();
  const maxDarkness = Math.max(0, ...entries.map((e) => e.darkness));
  const base = Number.isFinite(basePower) ? Math.max(0, Math.min(100, basePower)) : 0;
  if (entries.length === 0) return powers;
  if (maxDarkness <= 0) {
    for (const entry of entries) powers.set(entry.color, round(base));
    return powers;
  }
  if (output === 'cut-out') {
    for (const entry of entries) {
      powers.set(
        entry.color,
        round(base * Math.max(entry.darkness / maxDarkness, CUT_OUT_MIN_FRACTION)),
      );
    }
    return powers;
  }
  const lightestFirst = [...entries].sort((a, b) => a.darkness - b.darkness);
  let previous = 0;
  for (const entry of lightestFirst) {
    const step = (entry.darkness - previous) / maxDarkness;
    powers.set(entry.color, round(base * Math.max(step, STACKED_MIN_FRACTION)));
    previous = entry.darkness;
  }
  return powers;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Give each colour's freshly created operation its power (see the rule
 *  above), reading the colour each operation was bound to on the object's
 *  paths. Operations bound to no colour path are returned unchanged, and so
 *  is every operation when there is no colour-layer output or the machine is
 *  a CNC, whose operation power is not a tone. */
export function withColourLayerPowers(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
  output: ColourLayerOutput | undefined,
  machine?: { readonly kind: 'laser' | 'cnc' },
): ReadonlyArray<Layer> {
  if (output === undefined || machine?.kind === 'cnc' || !('paths' in object)) return operations;
  const colourByOperation = new Map<string, string>();
  for (const path of object.paths) {
    const id = path.operationIds?.[0];
    if (id !== undefined) colourByOperation.set(id, path.color.toLowerCase());
  }
  const colours = [...colourByOperation.values()];
  return operations.map((operation) => {
    const colour = colourByOperation.get(operation.id);
    if (colour === undefined) return operation;
    const power = colourLayerPowers(colours, operation.power, output).get(colour);
    return power === undefined || power === operation.power ? operation : { ...operation, power };
  });
}
