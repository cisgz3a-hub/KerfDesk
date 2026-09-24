// Exact-product tapered ball-nose carving bits (ADR-368). Each row copies the
// seller's own listing: tip diameter (twice the listed tip radius), per-side
// taper, fluted cutting length, and shank. The stored cut diameter is where a
// tangent taper of that angle ends at that cutting length, so the modeled
// flank ends where the listed flutes do. Sellers list the PER-SIDE
// angle ("5.4 Deg Tapered Angle", SpeTool's "Single Side Degree"). Read per
// side, seven rows below reach their shank 1-7% past the listed length; read as
// included angles they would need about twice it. The stored included angle is
// therefore the listed angle doubled (ADR-368). Flute counts are not copied: the
// material recipe reads the widest diameter, and a listed four-flute count
// would double an already coarse automatic feed for a small tip.

import { taperedBallDiameterAtHeightMm } from '../../core/cnc-tapered-ball';
import type { ModeledCncBitCatalogEntry } from './cnc-bit-catalog-types';

export type TaperedBallListing = {
  readonly id: string;
  readonly product: string;
  readonly tipDiameterMm: number;
  readonly tipLabel: string;
  readonly sideAngleDeg: number;
  readonly cuttingLengthMm: number;
  readonly cuttingLengthLabel: string;
  readonly shankDiameterMm: number;
  readonly shankLabel: string;
  readonly sourceUrl: string;
};

const AMANA = 'https://www.amanatool.com/';
const SPETOOL = 'https://spetools.com/products/';

export const TAPERED_BALL_LISTINGS: ReadonlyArray<TaperedBallListing> = [
  {
    id: 'tbn-amana-46280',
    product: 'Amana 46280',
    tipDiameterMm: 0.79375,
    tipLabel: '0.794 mm (1/32")',
    sideAngleDeg: 6.2,
    cuttingLengthMm: 25.4,
    cuttingLengthLabel: '25.4 mm (1")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${AMANA}46280-cnc-2d-and-3d-carving-6-2-deg-tapered-angle-ball-tip-x-1-32-dia-x-1-64-radius-x-1-x-1-4-shank-x-3-inch-long-x-3-flute-solid-sub-micrograin-carbide-zrn-coated-router-bit.html`,
  },
  {
    id: 'tbn-amana-46282',
    product: 'Amana 46282',
    tipDiameterMm: 1.5875,
    tipLabel: '1.588 mm (1/16")',
    sideAngleDeg: 5.4,
    cuttingLengthMm: 25.4,
    cuttingLengthLabel: '25.4 mm (1")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${AMANA}46282-u-cnc-2d-and-3d-carving-5-4-deg-tapered-angle-ball-tip-1-16-dia-x-1-32-radius-x-1-x-1-4-shank-x-3-inch-long-x-4-flute-solid-carbide-up-cut-spiral-router-bit.html`,
  },
  {
    id: 'tbn-amana-46286',
    product: 'Amana 46286',
    tipDiameterMm: 3.175,
    tipLabel: '3.175 mm (1/8")',
    sideAngleDeg: 3.6,
    cuttingLengthMm: 25.4,
    cuttingLengthLabel: '25.4 mm (1")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${AMANA}46286-u-cnc-2d-and-3d-carving-3-6-deg-tapered-angle-ball-tip-1-8-dia-x-1-16-radius-x-1-x-1-4-shank-x-3-inch-long-x-3-flute-solid-carbide-up-cut-spiral-router-bit.html`,
  },
  {
    id: 'tbn-amana-46284',
    product: 'Amana 46284',
    tipDiameterMm: 3.175,
    tipLabel: '3.175 mm (1/8")',
    sideAngleDeg: 1,
    cuttingLengthMm: 38.1,
    cuttingLengthLabel: '38.1 mm (1-1/2")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${AMANA}46284-cnc-2d-and-3d-carving-1-deg-tapered-angle-ball-tip-1-8-dia-x-1-16-radius-x-1-1-2-x-1-4-shank-x-3-inch-long-x-3-flute-solid-sub-micrograin-carbide-zrn-coated-router-bit.html`,
  },
  {
    id: 'tbn-spetool-w01001',
    product: 'SpeTool W01001',
    tipDiameterMm: 0.5,
    tipLabel: '0.5 mm',
    sideAngleDeg: 5.12,
    cuttingLengthMm: 15,
    cuttingLengthLabel: '15 mm',
    shankDiameterMm: 3.175,
    shankLabel: '3.175 mm (1/8")',
    sourceUrl: `${SPETOOL}spetool-w01001-2d-3d-carving-engraving-tapered-ball-nose-router-bit-r-0-25mm-1-8-shank`,
  },
  {
    id: 'tbn-spetool-w01004',
    product: 'SpeTool W01004',
    tipDiameterMm: 2,
    tipLabel: '2 mm',
    sideAngleDeg: 2.24,
    cuttingLengthMm: 15,
    cuttingLengthLabel: '15 mm',
    shankDiameterMm: 3.175,
    shankLabel: '3.175 mm (1/8")',
    sourceUrl: `${SPETOOL}spetool-w01004-2d-3d-carving-engraving-tapered-ball-nose-router-bit-radius-1mm-1-8-shank`,
  },
  {
    id: 'tbn-spetool-w01006',
    product: 'SpeTool W01006',
    tipDiameterMm: 1,
    tipLabel: '1 mm',
    sideAngleDeg: 4.82,
    cuttingLengthMm: 31.75,
    cuttingLengthLabel: '31.75 mm (1-1/4")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${SPETOOL}spetool-w01006-2d-3d-carving-engraving-tapered-ball-nose-router-bit-radius-0-5mm-1-4-shank`,
  },
  {
    id: 'tbn-spetool-w01010',
    product: 'SpeTool W01010',
    tipDiameterMm: 2,
    tipLabel: '2 mm',
    sideAngleDeg: 3.92,
    cuttingLengthMm: 31.75,
    cuttingLengthLabel: '31.75 mm (1-1/4")',
    shankDiameterMm: 6.35,
    shankLabel: '6.35 mm (1/4")',
    sourceUrl: `${SPETOOL}spetool-w01010-2d-3d-carving-engraving-tapered-ball-nose-router-bit-radius-1mm-1-4-shank`,
  },
];

export const TAPERED_BALL_CATALOG: ReadonlyArray<ModeledCncBitCatalogEntry> =
  TAPERED_BALL_LISTINGS.map(taperedBallEntry);

function taperedBallEntry(listing: TaperedBallListing): ModeledCncBitCatalogEntry {
  const includedAngleDeg = listing.sideAngleDeg * 2;
  return {
    status: 'modeled',
    id: listing.id,
    family: 'tapered-ball-nose',
    familyLabel: 'Tapered ball-nose carving bits',
    tool: {
      name:
        `${listing.product} tapered ball nose — ${listing.tipLabel} tip, ` +
        `${listing.sideAngleDeg}° per side, ${listing.cuttingLengthLabel} flutes, ` +
        `${listing.shankLabel} shank`,
      kind: 'tapered-ball-nose',
      diameterMm: listedCutDiameterMm(listing, includedAngleDeg),
      tipDiameterMm: listing.tipDiameterMm,
      tipAngleDeg: includedAngleDeg,
      family: 'tapered-ball-nose',
      shankDiameterMm: listing.shankDiameterMm,
    },
    sourceUrl: listing.sourceUrl,
    sourceScope: 'exact-product',
  };
}

// Rounded to 0.01 mm for readable rows; that moves the modeled flute end by
// well under 1% of the listed length. A carving taper never exceeds its shank.
function listedCutDiameterMm(listing: TaperedBallListing, includedAngleDeg: number): number {
  const diameterMm = taperedBallDiameterAtHeightMm(
    listing.tipDiameterMm,
    includedAngleDeg,
    listing.cuttingLengthMm,
  );
  return Math.min(listing.shankDiameterMm, Math.round(diameterMm * 100) / 100);
}
