/**
 * T1-71: recovery prompt should fire on any meaningful autosave change,
 * not only scenes with placed objects. Verifies `evaluateRecoveryEligibility`
 * across the four positive cases (objects / custom layers / material /
 * machine) and the negative cases (default scene, malformed JSON, missing
 * scene block).
 *
 * Run: npx tsx tests/recovery-eligibility-non-empty-cases.test.ts
 */
import { evaluateRecoveryEligibility } from '../src/app/recoveryEligibility';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-71 recovery-eligibility ===\n');

// Default-only scene (single layer, null material, null machine, no objects)
// — this is what fires when the user opens the app and does nothing.
{
  const json = JSON.stringify({
    scene: {
      objects: [],
      layers: [{ id: 'L1', name: 'Cut' }],
      material: null,
      machine: null,
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(!e.shouldOffer, 'default-only scene: do NOT offer recovery');
  assert(e.reasons.length === 0, 'default-only scene: zero reasons');
}

// Scene with one object — the legacy criterion.
{
  const json = JSON.stringify({
    scene: {
      objects: [{ id: 'o1' }],
      layers: [{ id: 'L1' }],
      material: null,
      machine: null,
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(e.shouldOffer, 'object placed: offer recovery');
  assert(e.reasons.includes('objects'), 'object placed: reason includes "objects"');
}

// Scene with custom layers (more than the default Cut) but no objects —
// the audit's identified silent-loss case.
{
  const json = JSON.stringify({
    scene: {
      objects: [],
      layers: [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }],
      material: null,
      machine: null,
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(e.shouldOffer, 'custom layers without objects: offer recovery');
  assert(e.reasons.includes('customLayers'), 'reason includes "customLayers"');
}

// Scene with material setup but no objects/custom-layers.
{
  const json = JSON.stringify({
    scene: {
      objects: [],
      layers: [{ id: 'L1' }],
      material: { width: 200, height: 150, thickness: 3 },
      machine: null,
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(e.shouldOffer, 'material configured without objects: offer recovery');
  assert(e.reasons.includes('material'), 'reason includes "material"');
}

// Scene with machine config but otherwise default.
{
  const json = JSON.stringify({
    scene: {
      objects: [],
      layers: [{ id: 'L1' }],
      material: null,
      machine: { name: 'Falcon A1 Pro' },
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(e.shouldOffer, 'machine configured without objects: offer recovery');
  assert(e.reasons.includes('machine'), 'reason includes "machine"');
}

// Multiple reasons combined.
{
  const json = JSON.stringify({
    scene: {
      objects: [{ id: 'o1' }],
      layers: [{ id: 'L1' }, { id: 'L2' }],
      material: { width: 200 },
      machine: { name: 'X' },
    },
  });
  const e = evaluateRecoveryEligibility(json);
  assert(e.shouldOffer, 'multiple changes: offer recovery');
  assert(e.reasons.length === 4, 'multiple changes: all four reasons reported');
}

// Malformed JSON -> do not offer (T1-70 covers user-initiated retries).
{
  const e = evaluateRecoveryEligibility('{not valid json');
  assert(!e.shouldOffer, 'malformed JSON: do NOT offer recovery');
}

// Empty string -> do not offer.
{
  const e = evaluateRecoveryEligibility('');
  assert(!e.shouldOffer, 'empty string: do NOT offer recovery');
}

// Missing scene block (some other JSON shape) -> do not offer.
{
  const e = evaluateRecoveryEligibility(JSON.stringify({ unrelated: true }));
  assert(!e.shouldOffer, 'missing scene block: do NOT offer recovery');
}

// scene === null -> do not offer.
{
  const e = evaluateRecoveryEligibility(JSON.stringify({ scene: null }));
  assert(!e.shouldOffer, 'scene === null: do NOT offer recovery');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
