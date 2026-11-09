// lift-lid-panels — the ADR-693 lift-off lid: an open-top body whose walls
// rise the cavity plus one lip band, and a loose two-plate lid. The lid top
// covers the full outer footprint and rests on the wall rim; the lip plate,
// glued centred under it, drops inside the rim and locates the lid. The body
// reuses the open-top claim machinery on a surrogate spec, so its joints
// carry the same proofs as any open-top box.
//
// Lip fit: the opening is bounded by the walls' inner faces, which are stock
// faces, not cut edges, so the fit offset never widens it. The lip is drawn
// play/2 smaller than the opening before the fit pass shrinks it another
// play/2, leaving the ADR-106 contract — play == clearance — across the lip,
// half of it on each side.

import type { Polyline } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import { buildPanelClaims, WALL_NAMES, type PanelId } from './panel-claims';
import { panelOutline } from './panel-outline';
import type { PanelRings } from './panel-fit';

export type LiftLidPanel = PanelId | 'lid' | 'lid-lip';

export type LiftLidPart = {
  readonly name: string;
  readonly panel: LiftLidPanel;
  readonly rings: PanelRings;
};

/** The five body walls, then the lid top and its lip plate. */
export function buildLiftLidParts(spec: BoxSpec): ReadonlyArray<LiftLidPart> {
  const dims = deriveBoxDims(spec);
  const body: LiftLidPart[] = buildPanelClaims(liftLidBodySpec(spec)).map((claims) => ({
    name: WALL_NAMES[claims.panel],
    panel: claims.panel,
    rings: { outline: panelOutline(claims), cutouts: [] },
  }));
  const lipInsetMm = spec.clearanceMm / 4;
  return [
    ...body,
    {
      name: 'Lid',
      panel: 'lid',
      rings: { outline: rect(0, 0, dims.outerWidthMm, dims.outerDepthMm), cutouts: [] },
    },
    {
      name: 'Lid lip',
      panel: 'lid-lip',
      rings: {
        outline: rect(
          lipInsetMm,
          lipInsetMm,
          dims.innerWidthMm - lipInsetMm,
          dims.innerDepthMm - lipInsetMm,
        ),
        cutouts: [],
      },
    },
  ];
}

/**
 * The open-top body the lid sits on: the walls stand bottom + cavity + lip
 * band, one thickness under the outer height. Open-top adds only the bottom
 * T, so its inner height is the cavity plus the lip band; in outer mode the
 * entered height also carries the lid top, which the body does not.
 */
export function liftLidBodySpec(spec: BoxSpec): BoxSpec {
  const t = spec.thicknessMm;
  return {
    ...spec,
    style: 'open-top',
    heightMm: spec.dimensionMode === 'inner' ? spec.heightMm + t : spec.heightMm - t,
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  };
}
