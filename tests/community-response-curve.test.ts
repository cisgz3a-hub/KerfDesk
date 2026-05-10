/**
 * T3-24: pin the community-submitted response-curve ingestion
 * pipeline.
 *
 * Run: npx tsx tests/community-response-curve.test.ts
 */

import {
  adoptCommunityResponseCurve,
  COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION,
  exportCommunityResponseCurve,
  validateCommunityResponseCurve,
  type CommunityCurveValidationCode,
  type CommunityResponseCurveEnvelope,
} from '../src/core/materials/CommunityResponseCurve';
import type { ResponseCurve } from '../src/core/materials/ResponseCurve';
import { darknessToPower } from '../src/core/materials/ResponseCurve';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function validEnvelope(
  overrides: Partial<CommunityResponseCurveEnvelope> = {},
): CommunityResponseCurveEnvelope {
  return {
    format: 'laserforge-community-response-curve',
    formatVersion: COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION,
    materialName: '3mm birch plywood',
    calibrationSpeed: 1500,
    machine: { brand: 'Creality', model: 'Falcon A1 Pro', watts: 20 },
    contributor: { name: 'community' },
    calibratedAt: '2026-05-12T10:00:00Z',
    note: 'Test fixture',
    points: [
      { commandedPower: 0, observedDarkness: 0 },
      { commandedPower: 25, observedDarkness: 0.18 },
      { commandedPower: 50, observedDarkness: 0.45 },
      { commandedPower: 75, observedDarkness: 0.78 },
      { commandedPower: 100, observedDarkness: 1.0 },
    ],
    ...overrides,
  };
}

function hasCode(
  result: ReturnType<typeof validateCommunityResponseCurve>,
  code: CommunityCurveValidationCode,
): boolean {
  return result.issues.some((i) => i.code === code);
}

console.log('\n=== T3-24 community response curve ingestion ===\n');

void (async () => {
  // 1. Format-version constant is exported and stable.
  {
    assert(
      COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION === 1,
      'COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION === 1',
    );
  }

  // 2. Valid envelope passes.
  {
    const r = validateCommunityResponseCurve(validEnvelope());
    assert(r.ok === true, 'Valid envelope: ok=true');
    assert(r.issues.length === 0, 'Valid envelope: no issues');
  }

  // 3. Wrong format string fails.
  {
    const r = validateCommunityResponseCurve(validEnvelope({ format: 'something-else' as 'laserforge-community-response-curve' }));
    assert(hasCode(r, 'wrong-format'), 'wrong-format: detected');
  }

  // 4. Unsupported formatVersion fails.
  {
    const r = validateCommunityResponseCurve(validEnvelope({ formatVersion: 999 }));
    assert(hasCode(r, 'unsupported-format-version'), 'unsupported-format-version: detected');
  }

  // 5. Missing / empty materialName fails.
  {
    const r = validateCommunityResponseCurve(validEnvelope({ materialName: '' }));
    assert(hasCode(r, 'missing-material-name'), 'missing-material-name: empty string detected');

    const r2 = validateCommunityResponseCurve(validEnvelope({ materialName: '   ' }));
    assert(hasCode(r2, 'missing-material-name'), 'missing-material-name: whitespace-only detected');
  }

  // 6. Invalid calibrationSpeed fails.
  {
    const r1 = validateCommunityResponseCurve(validEnvelope({ calibrationSpeed: 0 }));
    assert(hasCode(r1, 'invalid-calibration-speed'), 'invalid-calibration-speed: zero detected');

    const r2 = validateCommunityResponseCurve(validEnvelope({ calibrationSpeed: -100 }));
    assert(hasCode(r2, 'invalid-calibration-speed'), 'invalid-calibration-speed: negative detected');
  }

  // 7. Invalid calibratedAt fails.
  {
    const r = validateCommunityResponseCurve(validEnvelope({ calibratedAt: 'not a date' }));
    assert(hasCode(r, 'invalid-calibrated-at'), 'invalid-calibrated-at: detected');
  }

  // 8. Too-few-points fails.
  {
    const r = validateCommunityResponseCurve(
      validEnvelope({
        points: [
          { commandedPower: 0, observedDarkness: 0 },
          { commandedPower: 100, observedDarkness: 1 },
        ],
      }),
    );
    assert(hasCode(r, 'too-few-points'), 'too-few-points: 2 samples rejected (min 4)');
  }

  // 9. Out-of-range power / darkness fails.
  {
    const r1 = validateCommunityResponseCurve(
      validEnvelope({
        points: [
          { commandedPower: 0, observedDarkness: 0 },
          { commandedPower: 50, observedDarkness: 1.5 },
          { commandedPower: 75, observedDarkness: 0.7 },
          { commandedPower: 100, observedDarkness: 1 },
        ],
      }),
    );
    assert(hasCode(r1, 'point-out-of-range'), 'point-out-of-range: darkness > 1 detected');

    const r2 = validateCommunityResponseCurve(
      validEnvelope({
        points: [
          { commandedPower: -10, observedDarkness: 0 },
          { commandedPower: 25, observedDarkness: 0.2 },
          { commandedPower: 50, observedDarkness: 0.5 },
          { commandedPower: 75, observedDarkness: 0.7 },
        ],
      }),
    );
    assert(hasCode(r2, 'point-out-of-range'), 'point-out-of-range: power < 0 detected');
  }

  // 10. Points not sorted fails.
  {
    const r = validateCommunityResponseCurve(
      validEnvelope({
        points: [
          { commandedPower: 0, observedDarkness: 0 },
          { commandedPower: 50, observedDarkness: 0.45 },
          { commandedPower: 25, observedDarkness: 0.18 },
          { commandedPower: 100, observedDarkness: 1 },
        ],
      }),
    );
    assert(hasCode(r, 'points-not-sorted'), 'points-not-sorted: detected');
  }

  // 11. Duplicate power point fails.
  {
    const r = validateCommunityResponseCurve(
      validEnvelope({
        points: [
          { commandedPower: 0, observedDarkness: 0 },
          { commandedPower: 50, observedDarkness: 0.45 },
          { commandedPower: 50, observedDarkness: 0.5 },
          { commandedPower: 100, observedDarkness: 1 },
        ],
      }),
    );
    assert(hasCode(r, 'duplicate-power-point'), 'duplicate-power-point: detected');
  }

  // 12. Non-object input rejects safely (no crash).
  {
    const r1 = validateCommunityResponseCurve(null);
    assert(r1.ok === false && hasCode(r1, 'wrong-format'), 'null input: rejected with wrong-format');

    const r2 = validateCommunityResponseCurve(42);
    assert(r2.ok === false && hasCode(r2, 'wrong-format'), 'number input: rejected');

    const r3 = validateCommunityResponseCurve('a string');
    assert(r3.ok === false && hasCode(r3, 'wrong-format'), 'string input: rejected');
  }

  // 13. adoptCommunityResponseCurve produces a canonical curve usable
  //     by darknessToPower.
  {
    const env = validEnvelope();
    const curve = adoptCommunityResponseCurve(env, 'resp_test_001');
    assert(curve.id === 'resp_test_001', 'Adopt: id supplied by caller');
    assert(curve.materialName === env.materialName, 'Adopt: materialName preserved');
    assert(curve.calibrationSpeed === env.calibrationSpeed, 'Adopt: calibrationSpeed preserved');
    assert(curve.points.length === env.points.length, 'Adopt: points count preserved');
    assert(curve.note === env.note, 'Adopt: note preserved');
    // Canonical curve must work with the existing darknessToPower
    // interpolator. At darkness=0 → power 0 (extrapolated to first
    // point); at darkness=1 → power 100 (last point); midpoints
    // monotonic.
    const p0 = darknessToPower(curve, 0);
    const p1 = darknessToPower(curve, 1);
    assert(p0 === 0, 'Adopt: darknessToPower(0) === 0 (first point)');
    assert(p1 === 100, 'Adopt: darknessToPower(1) === 100 (last point)');
    const mid = darknessToPower(curve, 0.5);
    assert(mid > 25 && mid < 75, `Adopt: darknessToPower(0.5) interpolates within [25,75] (got ${mid})`);
  }

  // 14. exportCommunityResponseCurve round-trips through validate +
  //     adopt without losing data.
  {
    const original: ResponseCurve = {
      id: 'resp_foo',
      materialName: '4mm acrylic',
      calibrationSpeed: 1000,
      points: [
        { commandedPower: 0, observedDarkness: 0 },
        { commandedPower: 30, observedDarkness: 0.2 },
        { commandedPower: 60, observedDarkness: 0.55 },
        { commandedPower: 90, observedDarkness: 0.85 },
      ],
      calibratedAt: '2026-05-12T11:00:00Z',
      note: 'round-trip test',
    };
    const envelope = exportCommunityResponseCurve(original, {
      machine: { brand: 'Creality', model: 'Falcon A1 Pro', watts: 20 },
      contributor: { name: 'roundtrip' },
    });
    assert(envelope.format === 'laserforge-community-response-curve', 'Export: format set');
    assert(envelope.formatVersion === COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION, 'Export: formatVersion set');

    const validation = validateCommunityResponseCurve(envelope);
    assert(validation.ok === true, 'Round-trip: exported envelope passes validation');

    const re = adoptCommunityResponseCurve(envelope, 'resp_roundtrip');
    assert(re.materialName === original.materialName, 'Round-trip: materialName preserved');
    assert(re.calibrationSpeed === original.calibrationSpeed, 'Round-trip: calibrationSpeed preserved');
    assert(re.points.length === original.points.length, 'Round-trip: point count preserved');
    for (let i = 0; i < original.points.length; i++) {
      assert(
        re.points[i].commandedPower === original.points[i].commandedPower
        && re.points[i].observedDarkness === original.points[i].observedDarkness,
        `Round-trip: point[${i}] preserved`,
      );
    }
  }

  // 15. JSON round-trip survives a parse/stringify cycle (the actual
  //     transport path: contributor exports JSON to disk, recipient
  //     loads via FileReader → JSON.parse → validate).
  {
    const env = validEnvelope();
    const serialized = JSON.stringify(env);
    const parsed = JSON.parse(serialized);
    const r = validateCommunityResponseCurve(parsed);
    assert(r.ok === true, 'JSON round-trip: validation still passes after stringify/parse');
  }

  console.log(`\nT3-24 community response curve: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
