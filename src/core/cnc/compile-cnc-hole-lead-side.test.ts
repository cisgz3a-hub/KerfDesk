import { describe, expect, it } from 'vitest';
import { holeLeadAssertions } from './compile-cnc-hole-lead-side-assertions.test-support';
import { holeLeadFixtures } from './compile-cnc-hole-lead-side-fixtures.test-support';

// ADR-252 regression. A hole's waste is the slug INSIDE its tool-center ring, so
// every point of the hole's lead must lie inside that ring. Measuring against the
// hole's drawn boundary instead is too loose: a point one tool radius outside the
// ring still falls inside the drawn boundary while the cutter is already eating
// the kept part beyond the finished wall.

describe('hole lead side under cut-direction enforcement', () => {
  for (const direction of holeLeadFixtures.cutDirections) {
    it(`keeps the hole lead inside the hole tool-center ring (${direction})`, () => {
      const pair = holeLeadFixtures.compileWithAndWithoutLead(
        holeLeadFixtures.holedPart(),
        direction,
      );
      const ring = holeLeadAssertions.outerHoleRoles(pair.ring);
      const led = holeLeadAssertions.outerHoleRoles(pair.led);
      holeLeadAssertions.expectInteriorWasteLead(ring.hole, led.hole);
    });

    it(`normalizes reversed source winding before resolving lead sides (${direction})`, () => {
      const pair = holeLeadFixtures.compileWithAndWithoutLead(
        holeLeadFixtures.holedPart('reversed'),
        direction,
      );
      const ring = holeLeadAssertions.outerHoleRoles(pair.ring);
      const led = holeLeadAssertions.outerHoleRoles(pair.led);
      holeLeadAssertions.expectInteriorWasteLead(ring.hole, led.hole);
      holeLeadAssertions.expectExteriorWasteLead(ring.outer, led.outer);
    });

    it(`resolves each disjoint outer/hole part independently (${direction})`, () => {
      const pair = holeLeadFixtures.compileWithAndWithoutLead(
        holeLeadFixtures.disjointHoledParts(),
        direction,
      );
      for (const side of holeLeadFixtures.partSides) {
        const ring = holeLeadAssertions.rolesOnSide(pair.ring, side);
        const led = holeLeadAssertions.rolesOnSide(pair.led, side);
        holeLeadAssertions.expectInteriorWasteLead(ring.hole, led.hole);
        holeLeadAssertions.expectExteriorWasteLead(ring.outer, led.outer);
      }
    });

    it(`keeps a depth-two island on the outer lead side (${direction})`, () => {
      const pair = holeLeadFixtures.compileWithAndWithoutLead(
        holeLeadFixtures.nestedIslandPart(),
        direction,
      );
      const ring = holeLeadAssertions.nestedRoles(pair.ring);
      const led = holeLeadAssertions.nestedRoles(pair.led);
      holeLeadAssertions.expectExteriorWasteLead(ring.island, led.island);
      holeLeadAssertions.expectInteriorWasteLead(ring.hole, led.hole);
      holeLeadAssertions.expectExteriorWasteLead(ring.outer, led.outer);
    });

    it(`keeps every roughing and finishing hole lead inside across depth steps (${direction})`, () => {
      const pair = holeLeadFixtures.compileWithAndWithoutLead(
        holeLeadFixtures.holedPart(),
        direction,
        {
          depthMm: holeLeadFixtures.deepDepthMm,
          depthPerPassMm: holeLeadFixtures.defaultDepthMm,
          finishAllowanceMm: holeLeadFixtures.finishAllowanceMm,
          tabsEnabled: false,
          toolId: holeLeadFixtures.secondToolId,
        },
      );
      const ringPasses = holeLeadAssertions.deepHolePasses(pair.ring);
      const ledPasses = holeLeadAssertions.deepHolePasses(pair.led);
      expect(pair.led.toolId).toBe(holeLeadFixtures.secondToolId);
      expect(pair.led.toolDiameterMm).toBe(holeLeadFixtures.secondToolDiameterMm);
      expect(ringPasses).toHaveLength(holeLeadAssertions.expectedDeepHolePassCount);
      expect(ledPasses).toHaveLength(holeLeadAssertions.expectedDeepHolePassCount);
      const holeDepths = [...new Set(ledPasses.map(holeLeadAssertions.passDepthMm))].sort(
        (first, second) => first - second,
      );
      expect(holeDepths).toEqual(holeLeadFixtures.expectedHoleDepthsMm);
      for (const [index, ring] of ringPasses.entries()) {
        const led = ledPasses[index];
        if (led === undefined) throw new Error(holeLeadAssertions.expectedRoleError);
        holeLeadAssertions.expectInteriorWasteLead(ring, led);
      }
      const fullDepthSpans = ledPasses
        .filter((pass) => holeLeadAssertions.passDepthMm(pass) === -holeLeadFixtures.deepDepthMm)
        .map((pass) =>
          holeLeadAssertions.passSpanX(pass).toFixed(holeLeadAssertions.spanPrecisionDigits),
        );
      expect(new Set(fullDepthSpans).size).toBe(holeLeadAssertions.expectedFullDepthSpanCount);
    });
  }
});
