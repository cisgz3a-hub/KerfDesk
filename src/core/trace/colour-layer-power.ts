// Per-colour operation power for a colour-layer trace (ADR-430).
//
// Darker colours should burn darker, so each colour's power follows its
// absolute darkness D = 1 - L, with L the OKLab lightness (0 black .. 1
// white) and P the operation's power as created (the operator's layer
// default). D is read against a reference R = max(D_max, 0.5): the darkest
// colour keeps P only when it is at least mid-dark, so a lone pale layer is
// never promoted to full power just because nothing darker was traced.
//   - cut-out: every area is burned once, by its own colour's operation, so
//       power_i = P * max(D_i / R, 0.25)
//     never below a quarter of P so a pale colour still marks.
//   - stacked: an area is burned by its own operation AND every lighter one
//     stacked below it, so each operation adds only its darkness step:
//       power_i = P * max((D_i - D_prev) / R, 0.1)
//     where D_prev is the next lighter burned colour's darkness (0 for the
//     lightest). The doses then sum to P * D_i / R, the cut-out rule's
//     target; the 10 % floor keeps near-equal tones from a zero-power step.
// Paper is not burned: a near-white colour (L >= 0.97) and, when the operator
// chose "Trace background colour", the traced paper colour are created with
// output OFF and 0 % power. Their outline stays in the project (for
// alignment or a cut); the operator turns the output on deliberately.
// Powers are rounded to 0.1 %. Pure core.

import type { Layer, SceneObject } from '../scene';
import type { ColourLayerOutput } from './colour-layer-options';
import { hexOkLightness } from './colour-oklab';
import { PAPER_MIN_LIGHTNESS } from './colour-quantize';

const CUT_OUT_MIN_FRACTION = 0.25;
const STACKED_MIN_FRACTION = 0.1;
/** Darkness at or above which the darkest colour gets the full power. */
const FULL_POWER_MIN_DARKNESS = 0.5;
/** Colours at least this light are paper, not ink (#fff8dc is ~0.977,
 *  pure yellow ~0.968). */
export const NEAR_WHITE_LIGHTNESS = 0.97;

export type ColourLayerSetting = {
  /** 0..100 percent of the operation. */
  readonly power: number;
  /** False for paper: the operation is created with output off. */
  readonly output: boolean;
};

export type ColourLayerCommit = {
  readonly output: ColourLayerOutput;
  /** "Trace background colour" was on: the lightest traced colour, when
   *  paper-light, is the paper and is not burned. */
  readonly paperTraced?: boolean;
};

/** Power and output for each colour, keyed by lowercase #rrggbb. */
export function colourLayerSettings(
  colours: ReadonlyArray<string>,
  basePower: number,
  commit: ColourLayerCommit,
): Map<string, ColourLayerSetting> {
  const lightestFirst = [...new Set(colours.map((c) => c.toLowerCase()))]
    .map((color) => ({ color, lightness: hexOkLightness(color) }))
    .sort((a, b) => b.lightness - a.lightness || (a.color < b.color ? -1 : 1));
  const paper = paperColour(lightestFirst, commit.paperTraced === true);
  const base = Number.isFinite(basePower) ? Math.max(0, Math.min(100, basePower)) : 0;
  const burned = lightestFirst
    .filter((e) => e.color !== paper && e.lightness < NEAR_WHITE_LIGHTNESS)
    .map((e) => ({ color: e.color, darkness: Math.max(0, 1 - e.lightness) }));
  const settings = new Map<string, ColourLayerSetting>();
  for (const entry of lightestFirst) settings.set(entry.color, { power: 0, output: false });
  const reference = Math.max(FULL_POWER_MIN_DARKNESS, ...burned.map((e) => e.darkness));
  let previous = 0;
  for (const entry of burned) {
    const fraction =
      commit.output === 'cut-out'
        ? Math.max(entry.darkness / reference, CUT_OUT_MIN_FRACTION)
        : Math.max((entry.darkness - previous) / reference, STACKED_MIN_FRACTION);
    previous = entry.darkness;
    settings.set(entry.color, { power: round(base * fraction), output: true });
  }
  return settings;
}

// With "Trace background colour" on, the paper is the lightest traced colour
// when it is paper-light (the quantiser only reports a paper that is both the
// border colour and paper-light); otherwise nothing is.
function paperColour(
  lightestFirst: ReadonlyArray<{ readonly color: string; readonly lightness: number }>,
  paperTraced: boolean,
): string | undefined {
  const lightest = lightestFirst[0];
  if (!paperTraced || lightest === undefined) return undefined;
  return lightest.lightness >= PAPER_MIN_LIGHTNESS ? lightest.color : undefined;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Give each colour's freshly created operation its power and output (see
 *  the rule above), reading the colour each operation was bound to on the
 *  object's paths. Operations bound to no colour path are returned unchanged,
 *  and so is every operation when there is no colour-layer commit. On a CNC,
 *  whose operation power is not a tone, only the paper's output-off applies:
 *  the paper is stock, not something to machine. */
export function withColourLayerPowers(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
  commit: ColourLayerCommit | undefined,
  machine?: { readonly kind: 'laser' | 'cnc' },
): ReadonlyArray<Layer> {
  if (commit === undefined || !('paths' in object)) return operations;
  const cnc = machine?.kind === 'cnc';
  const colourByOperation = new Map<string, string>();
  for (const path of object.paths) {
    const id = path.operationIds?.[0];
    if (id !== undefined) colourByOperation.set(id, path.color.toLowerCase());
  }
  const colours = [...colourByOperation.values()];
  return operations.map((operation) => {
    const colour = colourByOperation.get(operation.id);
    if (colour === undefined) return operation;
    const setting = colourLayerSettings(colours, operation.power, commit).get(colour);
    if (setting === undefined) return operation;
    const power = cnc ? operation.power : setting.power;
    const output = operation.output && setting.output;
    if (power === operation.power && output === operation.output) return operation;
    return { ...operation, power, output };
  });
}
