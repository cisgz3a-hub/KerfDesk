// Chipload feeds & speeds calculator (ADR-103 G5, F-CNC24).
//
//   feed (mm/min) = RPM × flutes × chipload (mm/tooth)
//
// The chipload chart is a PROVISIONAL starter set of industry-typical
// mid-range values by material and bit-diameter band — the numbers every
// manufacturer chart clusters around, clearly labeled as starting points in
// the UI. Depth-per-pass and plunge percentage are rule-of-thumb fractions
// of bit diameter / feed. Everything is editable after Apply; nothing here
// claims to replace listening to the cut.

export type ChiploadMaterial = 'softwood' | 'hardwood' | 'plywood-mdf' | 'acrylic' | 'aluminum';

export type FeedsCalculatorInput = {
  readonly material: ChiploadMaterial;
  readonly bitDiameterMm: number;
  readonly flutes: number;
  readonly rpm: number;
  // Machine feed ceiling (device.maxFeed). When set, the returned feed and
  // plunge never exceed it — a suggestion the machine cannot run is useless.
  readonly maxFeedMmPerMin?: number;
};

export type FeedsCalculatorOk = {
  readonly kind: 'ok';
  readonly chiploadMm: number;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly depthPerPassMm: number;
};

export type FeedsCalculatorResult =
  | FeedsCalculatorOk
  | { readonly kind: 'error'; readonly reason: string };

export const CHIPLOAD_MATERIALS: ReadonlyArray<{
  readonly value: ChiploadMaterial;
  readonly label: string;
}> = [
  { value: 'softwood', label: 'Softwood' },
  { value: 'hardwood', label: 'Hardwood' },
  { value: 'plywood-mdf', label: 'Plywood / MDF' },
  { value: 'acrylic', label: 'Acrylic' },
  { value: 'aluminum', label: 'Aluminum' },
];

const CHIPLOAD_MATERIAL_KEYS: ReadonlySet<string> = new Set(
  CHIPLOAD_MATERIALS.map((material) => material.value),
);

// Narrow an arbitrary value to a known chipload material key. Shared by the
// .lf2 normalizers (layer + stock materialKey) and the project-material picker
// so a stale/unknown key is rejected instead of reaching calculateFeeds.
export function isChiploadMaterialKey(value: unknown): value is ChiploadMaterial {
  return typeof value === 'string' && CHIPLOAD_MATERIAL_KEYS.has(value);
}

// Diameter bands (mm): ≤1.5, ≤3.175 (1/8"), ≤6.35 (1/4"), larger.
const BAND_LIMITS_MM = [1.5, 3.175, 6.35] as const;

// mm/tooth per band, mid-range starting values.
const CHIPLOAD_CHART: Readonly<
  Record<ChiploadMaterial, readonly [number, number, number, number]>
> = {
  softwood: [0.03, 0.05, 0.11, 0.19],
  hardwood: [0.02, 0.04, 0.1, 0.15],
  'plywood-mdf': [0.03, 0.06, 0.11, 0.18],
  acrylic: [0.03, 0.05, 0.1, 0.15],
  aluminum: [0.01, 0.02, 0.05, 0.08],
};

// Depth-per-pass as a fraction of bit diameter.
const DEPTH_FACTOR: Readonly<Record<ChiploadMaterial, number>> = {
  softwood: 0.5,
  hardwood: 0.4,
  'plywood-mdf': 0.5,
  acrylic: 0.3,
  aluminum: 0.1,
};

// Plunge feed as a fraction of the cutting feed.
const PLUNGE_FACTOR: Readonly<Record<ChiploadMaterial, number>> = {
  softwood: 0.4,
  hardwood: 0.4,
  'plywood-mdf': 0.4,
  acrylic: 0.3,
  aluminum: 0.15,
};

const MIN_FEED_MM_PER_MIN = 50;
const ROUND_FEED_TO_MM = 10;
const ROUND_DEPTH_TO_MM = 0.1;

export function chiploadFor(material: ChiploadMaterial, bitDiameterMm: number): number {
  const chart = CHIPLOAD_CHART[material];
  for (let band = 0; band < BAND_LIMITS_MM.length; band += 1) {
    const limit = BAND_LIMITS_MM[band];
    if (limit !== undefined && bitDiameterMm <= limit) return chart[band] ?? 0;
  }
  return chart[3];
}

export function calculateFeeds(input: FeedsCalculatorInput): FeedsCalculatorResult {
  const bitError = positiveFiniteReason('Bit diameter', input.bitDiameterMm);
  if (bitError !== null) return { kind: 'error', reason: bitError };
  const flutesError = positiveFiniteReason('Flute count', input.flutes);
  if (flutesError !== null) return { kind: 'error', reason: flutesError };
  const rpmError = positiveFiniteReason('RPM', input.rpm);
  if (rpmError !== null) return { kind: 'error', reason: rpmError };
  const chiploadMm = chiploadFor(input.material, input.bitDiameterMm);
  const rawFeed = input.rpm * Math.max(1, Math.round(input.flutes)) * chiploadMm;
  const uncappedFeed = Math.max(
    MIN_FEED_MM_PER_MIN,
    Math.round(rawFeed / ROUND_FEED_TO_MM) * ROUND_FEED_TO_MM,
  );
  // Never hand a caller a feed its machine cannot run — committing an
  // over-max feed just gets rejected by preflight later.
  const maxFeed = input.maxFeedMmPerMin;
  const feedMmPerMin =
    maxFeed !== undefined && maxFeed > 0 ? Math.min(uncappedFeed, maxFeed) : uncappedFeed;
  const plungeMmPerMin = Math.min(
    feedMmPerMin,
    Math.max(
      MIN_FEED_MM_PER_MIN / 2,
      Math.round((feedMmPerMin * PLUNGE_FACTOR[input.material]) / ROUND_FEED_TO_MM) *
        ROUND_FEED_TO_MM,
    ),
  );
  const depthPerPassMm =
    Math.max(
      ROUND_DEPTH_TO_MM,
      Math.round((input.bitDiameterMm * DEPTH_FACTOR[input.material]) / ROUND_DEPTH_TO_MM) *
        ROUND_DEPTH_TO_MM,
    ) || ROUND_DEPTH_TO_MM;
  return { kind: 'ok', chiploadMm, feedMmPerMin, plungeMmPerMin, depthPerPassMm };
}

function positiveFiniteReason(label: string, value: number): string | null {
  return Number.isFinite(value) && value > 0 ? null : `${label} must be a finite positive number.`;
}
