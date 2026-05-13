/**
 * T1-181 (external audit High #1 + #3): determinism gate for the
 * compile → start contract.
 *
 * The audit's framing: "the same scene can compile into different
 * toolpaths depending on license state or whichever profile
 * singleton is active at compile time" — and "user compiles a job,
 * profile changes, entitlement state changes, material curve
 * changes, or preset storage changes; the job preview and final
 * output can diverge from what the user thought they approved."
 *
 * T1-181 ships the minimal-but-meaningful gate first: hash the
 * compile-time inputs that drive output divergence (entitlement
 * policy + referenced material presets), attach the hashes to
 * `ValidatedJobTicket`, and recompute / verify at start time. A
 * mismatch refuses the start with a remediation message.
 *
 * Run: npx tsx tests/ticket-determinism-entitlement-and-presets.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureEntitlementPolicySnapshot,
  hashEntitlementPolicy,
  hashReferencedMaterialPresets,
  type EntitlementPolicySnapshot,
} from '../src/core/job/compileInputHashes';
import { validateJobTicket } from '../src/app/validateJobTicket';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { createScene } from '../src/core/scene/Scene';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-181 compile determinism: entitlement + material-preset hashes ===\n');

// -------- 1. captureEntitlementPolicySnapshot returns 6 boolean flags --------
{
  const snap = captureEntitlementPolicySnapshot();
  const keys: (keyof EntitlementPolicySnapshot)[] = [
    'allowTabs', 'allowOvercut', 'allowLeadIn',
    'allowCrossHatch', 'allowPowerScale', 'allowCutStartPoint',
  ];
  for (const k of keys) {
    assert(typeof snap[k] === 'boolean', `snapshot[${k}] is a boolean`);
  }
  assert(Object.keys(snap).length === keys.length, `snapshot has exactly ${keys.length} fields`);
}

// -------- 2. hashEntitlementPolicy is deterministic --------
{
  const snap1: EntitlementPolicySnapshot = {
    allowTabs: true, allowOvercut: true, allowLeadIn: true,
    allowCrossHatch: true, allowPowerScale: true, allowCutStartPoint: true,
  };
  const snap2: EntitlementPolicySnapshot = { ...snap1 };
  assert(hashEntitlementPolicy(snap1) === hashEntitlementPolicy(snap2), 'same snapshot → same hash');
}

// -------- 3. hashEntitlementPolicy differs when ANY flag flips --------
{
  const base: EntitlementPolicySnapshot = {
    allowTabs: true, allowOvercut: true, allowLeadIn: true,
    allowCrossHatch: true, allowPowerScale: true, allowCutStartPoint: true,
  };
  const baseHash = hashEntitlementPolicy(base);
  const keys: (keyof EntitlementPolicySnapshot)[] = [
    'allowTabs', 'allowOvercut', 'allowLeadIn',
    'allowCrossHatch', 'allowPowerScale', 'allowCutStartPoint',
  ];
  for (const k of keys) {
    const flipped = { ...base, [k]: false };
    assert(
      hashEntitlementPolicy(flipped) !== baseHash,
      `flipping ${k} changes the hash (any flag flip is detectable)`,
    );
  }
}

// -------- 4. hashReferencedMaterialPresets: scene with no presets uses sentinel --------
{
  const scene = createScene(400, 300, 'no-presets-scene');
  const h = hashReferencedMaterialPresets(scene);
  assert(h === hashString('no-material-presets'), 'empty-presets scene returns the sentinel hash');
}

// -------- 5. validateJobTicket: matching hashes pass; mismatch refuses --------
{
  const scene = createScene(400, 300, 'validate-test');
  const goodTicket: ValidatedJobTicket = {
    ticketId: 't',
    sceneHash: hashSceneForTicket(scene),
    profileHash: hashString('no-profile'),
    gcodeHash: hashString('G0 X1'),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    emittedBurnBounds: null,
    burnEnvelopeDivergence: null,
    fingerprint: makeTestJobFingerprint({
      scene,
      profile: null,
      startMode: 'absolute',
      savedOrigin: null,
    }),
    gcodeLines: ['G0 X1'],
    gcodeText: 'G0 X1',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    machineTransform: {} as never,
    controllerType: 'grbl',
    startMode: 'absolute' as never,
    savedOrigin: null,
    createdAt: Date.now(),
  } as ValidatedJobTicket;

  const okResult = validateJobTicket({
    ticket: goodTicket,
    scene,
    currentProfile: null,
    currentControllerType: 'grbl',
  });
  assert(okResult.ok === true, 'matching hashes → validator returns { ok: true }');

  // Tampered entitlement hash → refuse with the T1-181 message.
  const badEntitlement: ValidatedJobTicket = {
    ...goodTicket,
    entitlementPolicyHash: 'tampered-entitlement-hash',
  };
  const badEntitlementResult = validateJobTicket({
    ticket: badEntitlement,
    scene,
    currentProfile: null,
    currentControllerType: 'grbl',
  });
  assert(
    badEntitlementResult.ok === false,
    'tampered entitlement hash → validator refuses',
  );
  if (badEntitlementResult.ok === false) {
    assert(
      /License \/ feature entitlements changed/i.test(badEntitlementResult.reason),
      `entitlement-mismatch reason names the entitlement change (got: "${badEntitlementResult.reason}")`,
    );
  }

  // Tampered material-presets hash → refuse with the T1-181 message.
  const badPresets: ValidatedJobTicket = {
    ...goodTicket,
    materialPresetsHash: 'tampered-presets-hash',
  };
  const badPresetsResult = validateJobTicket({
    ticket: badPresets,
    scene,
    currentProfile: null,
    currentControllerType: 'grbl',
  });
  assert(
    badPresetsResult.ok === false,
    'tampered material-presets hash → validator refuses',
  );
  if (badPresetsResult.ok === false) {
    assert(
      /material preset.*changed/i.test(badPresetsResult.reason),
      `material-presets-mismatch reason names the preset change (got: "${badPresetsResult.reason}")`,
    );
  }
}

// -------- 6. Source pins on the ticket type + validator + pipeline --------
{
  const ticketSrc = readFileSync(resolve(here, '../src/core/job/ValidatedJobTicket.ts'), 'utf-8');
  const validatorSrc = readFileSync(resolve(here, '../src/app/validateJobTicket.ts'), 'utf-8');
  const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
  const hashesSrc = readFileSync(resolve(here, '../src/core/job/compileInputHashes.ts'), 'utf-8');

  assert(/T1-181/.test(ticketSrc), 'ValidatedJobTicket carries T1-181 marker');
  assert(
    /entitlementPolicyHash:\s*string/.test(ticketSrc),
    'ValidatedJobTicket declares entitlementPolicyHash field',
  );
  assert(
    /materialPresetsHash:\s*string/.test(ticketSrc),
    'ValidatedJobTicket declares materialPresetsHash field',
  );

  assert(/T1-181/.test(validatorSrc), 'validateJobTicket.ts carries T1-181 marker');
  assert(
    /entitlements changed|entitlement policy hash mismatch/i.test(validatorSrc),
    'validator emits the entitlement-mismatch user message',
  );
  assert(
    /material preset.*changed|material presets hash mismatch/i.test(validatorSrc),
    'validator emits the material-preset-mismatch user message',
  );

  assert(/T1-181/.test(pipelineSrc), 'PipelineService.ts carries T1-181 marker');
  assert(
    /entitlementPolicyHash:\s*hashEntitlementPolicy\(captureEntitlementPolicySnapshot\(\)\)/.test(pipelineSrc),
    'PipelineService populates entitlementPolicyHash from a fresh snapshot',
  );
  assert(
    /materialPresetsHash:\s*hashReferencedMaterialPresets\(scene\)/.test(pipelineSrc),
    'PipelineService populates materialPresetsHash from the scene',
  );

  assert(/T1-181/.test(hashesSrc), 'compileInputHashes.ts carries T1-181 marker');
  assert(/audit High #1 \+ #3/.test(hashesSrc), 'compileInputHashes.ts cross-references audit High #1 + #3');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
