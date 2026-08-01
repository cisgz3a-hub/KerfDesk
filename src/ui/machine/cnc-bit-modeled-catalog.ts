import type { CncToolKind } from '../../core/scene';
import type { ModeledCncBitCatalogEntry } from './cnc-bit-catalog-types';

type SizeSpec = {
  readonly key: string;
  readonly label: string;
  readonly diameterMm: number;
};

const IMPERIAL_FLAT_SIZES: ReadonlyArray<SizeSpec> = [
  { key: '003125', label: '0.794 mm (1/32")', diameterMm: 0.794 },
  { key: '00625', label: '1.588 mm (1/16")', diameterMm: 1.588 },
  { key: '0125', label: '3.175 mm (1/8")', diameterMm: 3.175 },
  { key: '01875', label: '4.763 mm (3/16")', diameterMm: 4.763 },
  { key: '025', label: '6.35 mm (1/4")', diameterMm: 6.35 },
  { key: '0375', label: '9.525 mm (3/8")', diameterMm: 9.525 },
  { key: '050', label: '12.7 mm (1/2")', diameterMm: 12.7 },
];

const METRIC_FLAT_SIZES: ReadonlyArray<SizeSpec> = [
  { key: 'm050', label: '0.5 mm', diameterMm: 0.5 },
  { key: 'm100', label: '1 mm', diameterMm: 1 },
  { key: 'm200', label: '2 mm', diameterMm: 2 },
  { key: 'm300', label: '3 mm', diameterMm: 3 },
  { key: 'm400', label: '4 mm', diameterMm: 4 },
  { key: 'm600', label: '6 mm', diameterMm: 6 },
  { key: 'm800', label: '8 mm', diameterMm: 8 },
  { key: 'm1000', label: '10 mm', diameterMm: 10 },
  { key: 'm1200', label: '12 mm', diameterMm: 12 },
];

const COMMON_SPIRAL_SIZES = [
  ...IMPERIAL_FLAT_SIZES.slice(1),
  ...METRIC_FLAT_SIZES.filter((size) => [2, 3, 6, 10].includes(size.diameterMm)),
];

const O_FLUTE_SIZES = [
  ...IMPERIAL_FLAT_SIZES.slice(1, 6),
  ...METRIC_FLAT_SIZES.filter((size) => [2, 3, 6, 10].includes(size.diameterMm)),
];

const AMANA_SINGLE_O_FLUTE =
  'https://www.amanatool.com/pub/media/productattachments/Aluminum-O-Flute-Speed-Chart-v6.pdf';
const AMANA_O_FLUTE_BALL_NOSE =
  'https://www.amanatool.com/products/cnc-router-bits/plastic-cutting-cnc-router-bits/solid-carbide-spiral-o-flute-ball-nose-plastic-cutting.html';

function modeledSeries(input: {
  readonly idPrefix: string;
  readonly family: string;
  readonly familyLabel: string;
  readonly toolLabel: string;
  readonly kind: CncToolKind;
  readonly sizes: ReadonlyArray<SizeSpec>;
  readonly fluteCount?: number;
  readonly sourceUrl: string;
}): ReadonlyArray<ModeledCncBitCatalogEntry> {
  return input.sizes.map((size) => ({
    status: 'modeled',
    id: `${input.idPrefix}-${size.key}`,
    family: input.family,
    familyLabel: input.familyLabel,
    tool: {
      name: `${size.label} ${input.toolLabel}`,
      kind: input.kind,
      diameterMm: size.diameterMm,
      family: input.family,
      ...(input.fluteCount === undefined ? {} : { fluteCount: input.fluteCount }),
    },
    sourceUrl: input.sourceUrl,
    sourceScope: 'family-reference',
  }));
}

const MODELED_SERIES: ReadonlyArray<ModeledCncBitCatalogEntry> = [
  ...modeledSeries({
    idPrefix: 'square',
    family: 'straight',
    familyLabel: 'Square / straight end mills',
    toolLabel: 'nominal square / straight end-mill envelope',
    kind: 'end-mill',
    sizes: [...IMPERIAL_FLAT_SIZES, ...METRIC_FLAT_SIZES],
    sourceUrl:
      'https://www.onsrud.com/images/LMT%20Onsrud%20Product%20Cutting%20Tools%20Catalog%20PCT-19.pdf',
  }),
  ...modeledSeries({
    idPrefix: 'upcut',
    family: 'upcut',
    familyLabel: 'Upcut spiral end mills',
    toolLabel: 'nominal upcut end-mill envelope',
    kind: 'end-mill',
    sizes: COMMON_SPIRAL_SIZES,
    sourceUrl: 'https://www.whitesiderouterbits.com/collections/up-cut-spirals',
  }),
  ...modeledSeries({
    idPrefix: 'downcut',
    family: 'downcut',
    familyLabel: 'Downcut spiral end mills',
    toolLabel: 'nominal downcut end-mill envelope',
    kind: 'end-mill',
    sizes: COMMON_SPIRAL_SIZES,
    sourceUrl: 'https://www.whitesiderouterbits.com/collections/down-cut-spirals',
  }),
  ...modeledSeries({
    idPrefix: 'compression',
    family: 'compression',
    familyLabel: 'Compression end mills',
    toolLabel: 'nominal compression end-mill envelope',
    kind: 'end-mill',
    sizes: IMPERIAL_FLAT_SIZES.slice(2),
    sourceUrl:
      'https://www.amanatool.com/pub/media/productattachments/Solid-Carbide-Spektra-Compression-Spirals-for-Baltic-Plywood_v4.pdf',
  }),
  ...modeledSeries({
    idPrefix: 'o-upcut',
    family: 'o-flute-upcut',
    familyLabel: 'Single O-flute upcut end mills',
    toolLabel: 'nominal single O-flute upcut end-mill envelope',
    kind: 'end-mill',
    sizes: O_FLUTE_SIZES,
    fluteCount: 1,
    sourceUrl: AMANA_SINGLE_O_FLUTE,
  }),
  ...modeledSeries({
    idPrefix: 'o-downcut',
    family: 'o-flute-downcut',
    familyLabel: 'Single O-flute downcut end mills',
    toolLabel: 'nominal single O-flute downcut end-mill envelope',
    kind: 'end-mill',
    sizes: IMPERIAL_FLAT_SIZES.slice(2, 5),
    fluteCount: 1,
    sourceUrl: AMANA_SINGLE_O_FLUTE,
  }),
  ...modeledSeries({
    idPrefix: 'o-straight',
    family: 'o-flute-straight',
    familyLabel: 'Single O-flute straight bits',
    toolLabel: 'nominal single O-flute straight-bit envelope',
    kind: 'end-mill',
    sizes: IMPERIAL_FLAT_SIZES.filter((size) => ['0125', '025'].includes(size.key)),
    fluteCount: 1,
    sourceUrl: 'https://www.whitesiderouterbits.com/products/sa1600',
  }),
  ...modeledSeries({
    idPrefix: 'o-double',
    family: 'o-flute-double',
    familyLabel: 'Double O-flute plastic-cutting bits',
    toolLabel: 'nominal double O-flute plastic-bit envelope',
    kind: 'end-mill',
    sizes: IMPERIAL_FLAT_SIZES.filter((size) => ['0125', '025', '0375'].includes(size.key)),
    fluteCount: 2,
    sourceUrl: 'https://www.amanatool.com/products/router-bits/plastic-cutting-router-bits.html',
  }),
  ...modeledSeries({
    idPrefix: 'mortise',
    family: 'mortise',
    familyLabel: 'Mortise-bit envelopes',
    toolLabel: 'nominal mortise-bit envelope',
    kind: 'end-mill',
    sizes: IMPERIAL_FLAT_SIZES.filter((size) => ['0125', '025', '0375', '050'].includes(size.key)),
    sourceUrl: 'https://www.whitesiderouterbits.com/collections/mortise-bits',
  }),
  ...modeledSeries({
    idPrefix: 'ball',
    family: 'ball-nose',
    familyLabel: 'Ball-nose end mills',
    toolLabel: 'nominal full-radius ball-nose envelope',
    kind: 'ball-nose',
    sizes: [...IMPERIAL_FLAT_SIZES, ...METRIC_FLAT_SIZES.slice(0, 7)],
    sourceUrl: 'https://shop.carbide3d.com/collections/cutters/ball-end',
  }),
  ...modeledSeries({
    idPrefix: 'core-box',
    family: 'core-box',
    familyLabel: 'Core-box / round-nose bits',
    toolLabel: 'nominal full-radius core-box envelope (no bearing modeled)',
    kind: 'ball-nose',
    sizes: IMPERIAL_FLAT_SIZES.slice(2),
    sourceUrl: 'https://www.whitesiderouterbits.com/collections/round-nose-core-box',
  }),
];

const POINT_V_BITS: ReadonlyArray<ModeledCncBitCatalogEntry> = [
  pointV(
    'v60-hobby-0125',
    60,
    6.35,
    3.175,
    'https://www.inventables.com/products/carbide-tip-v-bit-60-degree-1-4-in-cutting-x-1-8-in-shank',
  ),
  pointV(
    'v90-hobby-0125',
    90,
    6.35,
    3.175,
    'https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-4-in-cutting-x-1-8-in-shank',
  ),
  pointV(
    'v60-hobby-025',
    60,
    12.7,
    6.35,
    'https://www.inventables.com/products/carbide-tip-v-bit-60-degree-1-2-in-cutting-x-1-4-in-shank',
  ),
  pointV(
    'v90-hobby-025',
    90,
    12.7,
    6.35,
    'https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-2-in-cutting-x-1-4-in-shank',
  ),
  pointV('v120-075', 120, 19.05, 12.7, 'https://www.whitesiderouterbits.com/products/1564'),
];

const EXACT_BALL_BITS: ReadonlyArray<ModeledCncBitCatalogEntry> = [
  exactBall(
    'o-ball-0125-amana-51814',
    'Amana 51814 3.175 mm (1/8") O-flute upcut ball-nose bit',
    3.175,
    3.175,
  ),
  exactBall(
    'o-ball-025-amana-51818',
    'Amana 51818 6.35 mm (1/4") O-flute upcut ball-nose bit',
    6.35,
    6.35,
  ),
];

function exactBall(
  id: string,
  name: string,
  diameterMm: number,
  shankDiameterMm: number,
): ModeledCncBitCatalogEntry {
  return {
    status: 'modeled',
    id,
    family: 'o-flute-ball-nose',
    familyLabel: 'O-flute upcut ball-nose bits',
    tool: {
      name,
      kind: 'ball-nose',
      diameterMm,
      family: 'o-flute-ball-nose',
      shankDiameterMm,
    },
    sourceUrl: AMANA_O_FLUTE_BALL_NOSE,
    sourceScope: 'exact-product',
  };
}

function pointV(
  id: string,
  angleDeg: number,
  diameterMm: number,
  shankDiameterMm: number,
  sourceUrl: string,
): ModeledCncBitCatalogEntry {
  return {
    status: 'modeled',
    id,
    family: 'v-groove',
    familyLabel: 'Point-tip V-groove bits',
    tool: {
      name: `${angleDeg}° nominal V-bit (point-cone model) — ${diameterMm} mm cut / ${shankDiameterMm} mm shank`,
      kind: 'v-bit',
      diameterMm,
      tipAngleDeg: angleDeg,
      family: 'v-groove',
      shankDiameterMm,
    },
    sourceUrl,
    sourceScope: 'exact-product',
  };
}

export const MODELED_CNC_BIT_CATALOG: ReadonlyArray<ModeledCncBitCatalogEntry> = [
  ...MODELED_SERIES,
  ...EXACT_BALL_BITS,
  ...POINT_V_BITS,
];
