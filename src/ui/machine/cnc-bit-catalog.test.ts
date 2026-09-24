import { describe, expect, it } from 'vitest';
import { taperedBallCuttingLengthMm, taperedBallEnvelope } from '../../core/cnc-tapered-ball';
import {
  CNC_BIT_CATALOG,
  MODELED_CNC_BIT_CATALOG,
  REFERENCE_CNC_BIT_CATALOG,
} from './cnc-bit-catalog';
import { TAPERED_BALL_LISTINGS } from './cnc-bit-tapered-ball-catalog';

describe('CNC bit catalog', () => {
  it('keeps every catalog id unique and every research source scoped and HTTPS', () => {
    const ids = CNC_BIT_CATALOG.map((entry) => entry.id);
    expect(CNC_BIT_CATALOG).toHaveLength(167);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CNC_BIT_CATALOG.every((entry) => entry.sourceUrl.startsWith('https://'))).toBe(true);
    expect(
      CNC_BIT_CATALOG.every((entry) =>
        ['exact-product', 'family-reference', 'representative-product'].includes(entry.sourceScope),
      ),
    ).toBe(true);
  });

  it('pins exact-product and representative-product evidence scopes to reviewed entries', () => {
    expect(idsWithSourceScope('exact-product')).toEqual([
      'o-ball-0125-amana-51814',
      'o-ball-025-amana-51818',
      'tbn-amana-46280',
      'tbn-amana-46282',
      'tbn-amana-46284',
      'tbn-amana-46286',
      'tbn-spetool-w01001',
      'tbn-spetool-w01004',
      'tbn-spetool-w01006',
      'tbn-spetool-w01010',
      'v120-075',
      'v60-hobby-0125',
      'v60-hobby-025',
      'v90-hobby-0125',
      'v90-hobby-025',
    ]);
    expect(idsWithSourceScope('representative-product')).toEqual([
      'bowl-tray',
      'drag-vinyl-knife',
      'fishtail',
      'surfacing',
      'tangential-oscillating-knife',
    ]);
  });

  it('keeps generic envelopes free of unverified flute and plunge claims', () => {
    const generic = MODELED_CNC_BIT_CATALOG.filter(
      (entry) => entry.sourceScope === 'family-reference',
    );
    const oFluteFamilies = new Set([
      'o-flute-upcut',
      'o-flute-downcut',
      'o-flute-straight',
      'o-flute-double',
    ]);

    expect(
      generic
        .filter((entry) => !oFluteFamilies.has(entry.family))
        .every((entry) => entry.tool.fluteCount === undefined),
    ).toBe(true);
    expect(
      generic
        .filter((entry) => entry.tool.fluteCount !== undefined)
        .every((entry) => oFluteFamilies.has(entry.family)),
    ).toBe(true);
    expect(
      generic
        .filter((entry) => oFluteFamilies.has(entry.family))
        .every((entry) => entry.tool.fluteCount === (entry.family === 'o-flute-double' ? 2 : 1)),
    ).toBe(true);
    expect(generic.map((entry) => `${entry.familyLabel} ${entry.tool.name}`).join(' ')).not.toMatch(
      /center[- ]cut|plung/i,
    );
  });

  it('offers a broad modeled catalog without pretending unsupported shapes are end mills', () => {
    expect(MODELED_CNC_BIT_CATALOG).toHaveLength(96);
    expect(new Set(MODELED_CNC_BIT_CATALOG.map((entry) => entry.family))).toEqual(
      new Set([
        'straight',
        'upcut',
        'downcut',
        'compression',
        'o-flute-upcut',
        'o-flute-downcut',
        'o-flute-straight',
        'o-flute-double',
        'mortise',
        'ball-nose',
        'core-box',
        'o-flute-ball-nose',
        'v-groove',
        'tapered-ball-nose',
      ]),
    );
    expect(MODELED_CNC_BIT_CATALOG.some((entry) => entry.tool.kind === 'engraving')).toBe(false);
    expect(
      MODELED_CNC_BIT_CATALOG.every(
        (entry) =>
          entry.tool.family === entry.family &&
          Number.isFinite(entry.tool.diameterMm) &&
          entry.tool.diameterMm > 0 &&
          (entry.tool.fluteCount === undefined ||
            (Number.isInteger(entry.tool.fluteCount) && entry.tool.fluteCount > 0)),
      ),
    ).toBe(true);
  });

  it('pins the two hobby-router 90-degree nominal models and manufacturer-listed shanks', () => {
    expect(MODELED_CNC_BIT_CATALOG).toContainEqual(
      expect.objectContaining({
        id: 'v90-hobby-0125',
        tool: expect.objectContaining({
          diameterMm: 6.35,
          shankDiameterMm: 3.175,
          tipAngleDeg: 90,
        }),
      }),
    );
    expect(MODELED_CNC_BIT_CATALOG).toContainEqual(
      expect.objectContaining({
        id: 'v90-hobby-025',
        tool: expect.objectContaining({
          diameterMm: 12.7,
          shankDiameterMm: 6.35,
          tipAngleDeg: 90,
        }),
      }),
    );
  });

  it('pins the two exact Amana O-flute ball-nose products without inventing flute count', () => {
    const oneEighth = MODELED_CNC_BIT_CATALOG.find(
      (entry) => entry.id === 'o-ball-0125-amana-51814',
    );
    const oneQuarter = MODELED_CNC_BIT_CATALOG.find(
      (entry) => entry.id === 'o-ball-025-amana-51818',
    );

    expect(oneEighth).toMatchObject({
      sourceScope: 'exact-product',
      tool: {
        kind: 'ball-nose',
        diameterMm: 3.175,
        shankDiameterMm: 3.175,
        family: 'o-flute-ball-nose',
      },
    });
    expect(oneQuarter).toMatchObject({
      sourceScope: 'exact-product',
      tool: {
        kind: 'ball-nose',
        diameterMm: 6.35,
        shankDiameterMm: 6.35,
        family: 'o-flute-ball-nose',
      },
    });
    expect(oneEighth?.tool).not.toHaveProperty('fluteCount');
    expect(oneQuarter?.tool).not.toHaveProperty('fluteCount');
  });

  it('models each exact tapered ball nose from its listed tip, per-side taper and flute length', () => {
    expect(TAPERED_BALL_LISTINGS).toHaveLength(8);
    for (const listing of TAPERED_BALL_LISTINGS) {
      const entry = MODELED_CNC_BIT_CATALOG.find((candidate) => candidate.id === listing.id);
      expect(entry, listing.id).toMatchObject({
        sourceScope: 'exact-product',
        sourceUrl: listing.sourceUrl,
        family: 'tapered-ball-nose',
        tool: {
          kind: 'tapered-ball-nose',
          tipDiameterMm: listing.tipDiameterMm,
          // Sellers list the per-side taper; KerfDesk stores the included angle.
          tipAngleDeg: listing.sideAngleDeg * 2,
          shankDiameterMm: listing.shankDiameterMm,
        },
      });
      if (entry === undefined) throw new Error(`Missing catalog entry ${listing.id}`);
      expect(entry.tool).not.toHaveProperty('fluteCount');
      expect(entry.tool.diameterMm, listing.id).toBeLessThanOrEqual(listing.shankDiameterMm);
      const envelope = taperedBallEnvelope({ ...entry.tool, id: listing.id });
      if (envelope === null) throw new Error(`${listing.id} has no modeled envelope`);
      // The stored diameter is where the taper ends at the listed flute length;
      // rounding it to 0.01 mm moves that end by well under 1%.
      const lengthMm = taperedBallCuttingLengthMm(envelope);
      expect(Math.abs(lengthMm - listing.cuttingLengthMm) / listing.cuttingLengthMm).toBeLessThan(
        0.01,
      );
    }
  });

  it('keeps specialty geometry visible but reference-only', () => {
    expect(REFERENCE_CNC_BIT_CATALOG).toHaveLength(71);
    const labels = REFERENCE_CNC_BIT_CATALOG.map((entry) => entry.familyLabel).join(' ');
    expect(labels).toMatch(/Dovetail/);
    expect(labels).toMatch(/T-slot/);
    expect(labels).not.toMatch(/Tapered ball-nose/);
    expect(labels).toMatch(/Diamond-drag/);
    expect(labels).toMatch(/drill/i);
    expect(labels).toMatch(/Thread mills/);
    expect(labels).toMatch(/Cut taps/);
    expect(labels).toMatch(/Form taps/);
    expect(labels).toMatch(/Stile-and-rail/);
    expect(labels).toMatch(/surfacing/i);
    expect(labels).toMatch(/Left-hand and reverse-rotation/);
    expect(labels).toMatch(/Four-plus-flute, high-helix, and variable-helix/);
    expect(labels).toMatch(/Drag knives and vinyl cutters/);
    expect(labels).toMatch(/Tangential and oscillating knife systems/);
    expect(labels).toMatch(/Honeycomb and panel cutters/);
    expect(labels).toMatch(/Foam cutters/);
    expect(labels).toMatch(/Drill\/end mills/);
    expect(labels).toMatch(/Combination drill\/thread mills/);
    expect(labels).toMatch(/Combined drill\/countersink and drill\/counterbore/);
    expect(labels).toMatch(/Multi-axis lens and oval/);
    expect(labels).toMatch(/High-feed form/);
    expect(labels).toMatch(/ACM\/TCM flat-tip folding V-groove/);
    expect(labels).toMatch(/Driven rotary-wheel knives/);
    expect(labels).toMatch(/V-cut and bevel knife tools/);
    expect(labels).toMatch(/Point-cutting and plunge roundover\/ovolo/);
    expect(labels).toMatch(/Parallel square-end and ball-end engraving/);
    expect(labels).toMatch(/Plug cutters/);
    expect(labels).toMatch(/Spade drills/);
    expect(REFERENCE_CNC_BIT_CATALOG.some((entry) => entry.id === 'slotting-saw')).toBe(true);
    expect(REFERENCE_CNC_BIT_CATALOG.some((entry) => entry.id === 'saw-arbor')).toBe(false);
  });
});

function idsWithSourceScope(scope: (typeof CNC_BIT_CATALOG)[number]['sourceScope']): string[] {
  return CNC_BIT_CATALOG.filter((entry) => entry.sourceScope === scope)
    .map((entry) => entry.id)
    .sort();
}
