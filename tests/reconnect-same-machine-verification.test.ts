/**
 * T3-51: pin the identity-comparison logic used to detect when a
 * reconnect lands on a different physical machine than the one a
 * profile remembers.
 *
 * Run: npx tsx tests/reconnect-same-machine-verification.test.ts
 */

import type { DeviceIdentity } from '../src/controllers/ControllerInterface';
import {
  compareIdentities,
  isBlock,
  isMatch,
  isPrompt,
  makeIdentitySnapshot,
  type IdentityChangeKind,
  type IdentitySnapshot,
} from '../src/controllers/IdentityComparison';

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

function snap(overrides: Partial<IdentitySnapshot> = {}): IdentitySnapshot {
  return {
    firmwareVersion: '1.1h.20221128',
    buildOptions: 'VL,15,128',
    maxSpindle: 1000,
    bedWidthMm: 400,
    bedHeightMm: 300,
    homingDirection: 0,
    homingEnabled: true,
    laserMode: true,
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function live(overrides: Partial<DeviceIdentity> = {}): DeviceIdentity {
  return {
    firmwareVersion: '1.1h.20221128',
    buildOptions: 'VL,15,128',
    maxSpindle: 1000,
    bedWidthMm: 400,
    bedHeightMm: 300,
    homingDirection: 0,
    homingEnabled: true,
    laserMode: true,
    ...overrides,
  };
}

function hasKind(
  result: ReturnType<typeof compareIdentities>,
  kind: IdentityChangeKind,
): boolean {
  return result.changes.some((c) => c.kind === kind);
}

console.log('\n=== T3-51 reconnect-same-machine verification ===\n');

void (async () => {
  // 1. Identical snapshot vs live identity → match.
  {
    const c = compareIdentities(snap(), live());
    assert(c.verdict === 'match', 'Match: identical snapshot+live yields verdict match');
    assert(c.changes.length === 0, 'Match: no changes reported');
    assert(isMatch(c), 'Match: isMatch predicate true');
    assert(!isPrompt(c), 'Match: isPrompt false');
    assert(!isBlock(c), 'Match: isBlock false');
    assert(/matches the last-known/i.test(c.summary), 'Match: summary names match');
  }

  // 2. Bed-width mismatch → block.
  {
    const c = compareIdentities(snap({ bedWidthMm: 400 }), live({ bedWidthMm: 220 }));
    assert(c.verdict === 'block', 'Bed width mismatch: verdict block');
    assert(hasKind(c, 'bed-width-changed'), 'Bed width mismatch: bed-width-changed change');
    assert(/different machine/i.test(c.summary), 'Bed width mismatch: summary cites different machine');
    assert(/400.*220/.test(c.summary), 'Bed width mismatch: summary shows previous → current');
  }

  // 3. Bed-height mismatch → block.
  {
    const c = compareIdentities(snap({ bedHeightMm: 300 }), live({ bedHeightMm: 200 }));
    assert(c.verdict === 'block', 'Bed height mismatch: verdict block');
    assert(hasKind(c, 'bed-height-changed'), 'Bed height mismatch: bed-height-changed change');
  }

  // 4. Max spindle mismatch >1% → block (typical 1000 vs 255 case).
  {
    const c = compareIdentities(snap({ maxSpindle: 1000 }), live({ maxSpindle: 255 }));
    assert(c.verdict === 'block', 'Max spindle 1000 vs 255: verdict block');
    assert(hasKind(c, 'max-spindle-changed'), 'Max spindle 1000 vs 255: max-spindle-changed change');
  }

  // 5. Max spindle drift ≤1% → tolerated, no change reported.
  {
    const c = compareIdentities(snap({ maxSpindle: 1000 }), live({ maxSpindle: 1005 }));
    assert(c.verdict === 'match', 'Max spindle 1000 vs 1005 (0.5%): verdict match (tolerance)');
    assert(!hasKind(c, 'max-spindle-changed'), 'Max spindle 1000 vs 1005: no change reported');
  }

  // 6. Firmware version change → prompt (legitimate after flash).
  {
    const c = compareIdentities(
      snap({ firmwareVersion: '1.1h.20221128' }),
      live({ firmwareVersion: '1.1i.20240101' }),
    );
    assert(c.verdict === 'prompt', 'Firmware version change: verdict prompt');
    assert(hasKind(c, 'firmware-version-changed'), 'Firmware version change: firmware-version-changed');
    assert(!/different machine/i.test(c.summary), 'Firmware version change: summary not "different machine"');
  }

  // 7. Build options change → prompt.
  {
    const c = compareIdentities(snap({ buildOptions: 'VL,15,128' }), live({ buildOptions: 'VR,15,128' }));
    assert(c.verdict === 'prompt', 'Build options change: verdict prompt');
    assert(hasKind(c, 'build-options-changed'), 'Build options change: build-options-changed');
  }

  // 8. Homing-enabled and laser-mode toggles → prompt.
  {
    const c = compareIdentities(snap({ homingEnabled: true }), live({ homingEnabled: false }));
    assert(c.verdict === 'prompt', 'Homing toggle: verdict prompt');
    assert(hasKind(c, 'homing-enabled-changed'), 'Homing toggle: homing-enabled-changed');

    const c2 = compareIdentities(snap({ laserMode: true }), live({ laserMode: false }));
    assert(c2.verdict === 'prompt', 'Laser mode toggle: verdict prompt');
    assert(hasKind(c2, 'laser-mode-changed'), 'Laser mode toggle: laser-mode-changed');
  }

  // 9. Mixed: firmware change + bed mismatch → block (block wins).
  {
    const c = compareIdentities(
      snap(),
      live({ firmwareVersion: '1.1i.20240101', bedWidthMm: 220 }),
    );
    assert(c.verdict === 'block', 'Mixed firmware+bed: verdict block (block wins)');
    assert(hasKind(c, 'firmware-version-changed'), 'Mixed: firmware change reported');
    assert(hasKind(c, 'bed-width-changed'), 'Mixed: bed change reported');
    assert(c.changes.length === 2, 'Mixed: both changes preserved');
  }

  // 10. Stored fields null on one side → not a change (we cannot
  //     compare what we never observed).
  {
    const c = compareIdentities(
      snap({ firmwareVersion: null, buildOptions: null }),
      live({ firmwareVersion: '1.1h.20221128' }),
    );
    assert(
      c.verdict === 'match',
      'Null on stored side: not treated as a change (cannot compare)',
    );

    const c2 = compareIdentities(
      snap(),
      live({ firmwareVersion: null, buildOptions: null }),
    );
    assert(
      c2.verdict === 'match',
      'Null on live side: not treated as a change (cannot compare)',
    );
  }

  // 11. makeIdentitySnapshot composes a snapshot from live identity
  //     + capturedAt without dropping any field.
  {
    const id = live({
      firmwareVersion: '1.1h.20221128',
      buildOptions: 'VL,15,128',
      maxSpindle: 1000,
      bedWidthMm: 400,
      bedHeightMm: 300,
      homingDirection: 0,
      homingEnabled: true,
      laserMode: true,
    });
    const captured = 1_700_000_000_000;
    const s = makeIdentitySnapshot(id, captured);
    assert(s.firmwareVersion === '1.1h.20221128', 'makeIdentitySnapshot: firmwareVersion preserved');
    assert(s.buildOptions === 'VL,15,128', 'makeIdentitySnapshot: buildOptions preserved');
    assert(s.maxSpindle === 1000, 'makeIdentitySnapshot: maxSpindle preserved');
    assert(s.bedWidthMm === 400, 'makeIdentitySnapshot: bedWidthMm preserved');
    assert(s.bedHeightMm === 300, 'makeIdentitySnapshot: bedHeightMm preserved');
    assert(s.homingDirection === 0, 'makeIdentitySnapshot: homingDirection preserved');
    assert(s.homingEnabled === true, 'makeIdentitySnapshot: homingEnabled preserved');
    assert(s.laserMode === true, 'makeIdentitySnapshot: laserMode preserved');
    assert(s.capturedAt === captured, 'makeIdentitySnapshot: capturedAt preserved');
  }

  // 12. Round-trip: snapshot -> compare against the same identity -> match.
  {
    const id = live();
    const s = makeIdentitySnapshot(id, 1_700_000_000_000);
    const c = compareIdentities(s, id);
    assert(c.verdict === 'match', 'Round-trip: makeIdentitySnapshot -> compare -> match');
  }

  // 13. Source pin: T3-51 module is additive only.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/controllers/IdentityComparison.ts'),
      'utf-8',
    );

    assert(/T3-51/.test(moduleSrc), 'Source: T3-51 marker present in module');
    assert(
      !/from\s+['"][^'"]*\/storage(['"\/])/.test(moduleSrc),
      'Source: IdentityComparison does not import storage (additive-only)',
    );
    assert(
      !/from\s+['"][^'"]*\/DeviceProfile(['"\/])/.test(moduleSrc),
      'Source: IdentityComparison does not import DeviceProfile (additive-only)',
    );
    assert(
      /import\s+type\s+\{\s*DeviceIdentity\s*\}/.test(moduleSrc),
      'Source: DeviceIdentity imported as type-only',
    );
  }

  console.log(`\nT3-51 reconnect verification: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
