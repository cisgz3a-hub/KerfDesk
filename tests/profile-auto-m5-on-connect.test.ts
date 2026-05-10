/**
 * T3-90 (T1-25 follow-up): when the active profile opts in via
 * `autoM5OnConnect: true`, `MachineService.connectRealLaser` arms a
 * one-shot state-change listener that fires `M5 S0` once the
 * connect-time safe-state handshake (T1-25) records a clean idle/
 * FS:0,0 verdict.
 *
 * Run: npx tsx tests/profile-auto-m5-on-connect.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function readSrc(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf-8');
}

console.log('\n=== T3-90 profile autoM5OnConnect ===\n');

void (async () => {
  // 1. DeviceProfile interface declares the optional field.
  {
    const profileSrc = readSrc('src/core/devices/DeviceProfile.ts');
    assert(
      /autoM5OnConnect\s*\?\s*:\s*boolean/.test(profileSrc),
      'DeviceProfile: autoM5OnConnect?: boolean field declared',
    );
    assert(
      /T3-90/.test(profileSrc),
      'DeviceProfile: T3-90 marker present in field documentation',
    );
    assert(
      /T1-25/.test(profileSrc),
      'DeviceProfile: T1-25 cross-reference present (follow-up rationale)',
    );
  }

  // 2. MachineService imports getActiveProfile and uses it from the
  //    auto-M5 path.
  {
    const svcSrc = readSrc('src/app/MachineService.ts');
    assert(
      /import\s+\{[^}]*getActiveProfile[^}]*\}\s+from\s+['"]\.\.\/core\/devices\/DeviceProfile['"]/.test(svcSrc),
      'MachineService imports getActiveProfile',
    );
    assert(
      /_armAutoM5OnConnect\b/.test(svcSrc),
      'MachineService declares _armAutoM5OnConnect',
    );
  }

  // 3. The auto-M5 arm runs after a successful connect (in
  //    connectRealLaser, after `controller.connect` resolves).
  {
    const svcSrc = readSrc('src/app/MachineService.ts');
    // The connect path's success branch should call _armAutoM5OnConnect
    // after `this._setLaserOutputState('off')`. Match the sequence.
    const connectBlock = svcSrc.match(
      /this\._setLaserOutputState\('off'\);[\s\S]{0,400}?this\._armAutoM5OnConnect\(\);/,
    );
    assert(
      connectBlock !== null,
      'MachineService: _armAutoM5OnConnect called after _setLaserOutputState(\'off\') in connect path',
    );
  }

  // 4. The auto-M5 arm gates on profile.autoM5OnConnect === true.
  //    A regression that flipped the gate to a different field would
  //    break the opt-in semantics.
  {
    const svcSrc = readSrc('src/app/MachineService.ts');
    const armBody = svcSrc.match(
      /_armAutoM5OnConnect\(\)\s*:\s*void\s*\{([\s\S]*?)^\s*\}/m,
    );
    assert(armBody !== null, '_armAutoM5OnConnect body is parseable');
    if (armBody) {
      const body = armBody[1] ?? '';
      assert(
        /profile\?\.autoM5OnConnect\s*!==\s*true/.test(body),
        '_armAutoM5OnConnect: gates on profile.autoM5OnConnect === true (early-return otherwise)',
      );
      assert(
        /getActiveProfile\(\)/.test(body),
        '_armAutoM5OnConnect: reads the active profile via getActiveProfile()',
      );
      assert(
        /onStateChange\b/.test(body),
        '_armAutoM5OnConnect: subscribes to controller.onStateChange',
      );
      assert(
        /getUnsafeAtConnect/.test(body),
        '_armAutoM5OnConnect: consults controller.getUnsafeAtConnect',
      );
      assert(
        /sendCommand\(\s*['"]M5\s+S0['"]/.test(body),
        '_armAutoM5OnConnect: fires `M5 S0` via sendCommand',
      );
      assert(
        /'internal'/.test(body),
        '_armAutoM5OnConnect: uses the `internal` command source',
      );
      // One-shot — the listener auto-unsubscribes after firing.
      assert(
        /unsubscribe\(\)/.test(body) || /unsubscribed\s*=\s*true/.test(body),
        '_armAutoM5OnConnect: listener auto-unsubscribes after firing',
      );
    }
  }

  // 5. Behavioral pin via the live profile-storage path. Save a
  //    profile with `autoM5OnConnect: true`, set it active, then
  //    invoke `_armAutoM5OnConnect` against a stub controller and
  //    confirm M5 fires on idle / no-fire on alarm verdict / one-shot
  //    on repeat idle. Storage is in-memory (`InMemoryStorageAdapter`).
  {
    const { MachineService } = await import('../src/app/MachineService');
    const profileMod = await import('../src/core/devices/DeviceProfile');
    const { InMemoryStorageAdapter } = await import(
      '../src/core/storage/InMemoryStorageAdapter'
    );
    const { setStorageForTest } = await import('../src/core/storage/storage');

    setStorageForTest(new InMemoryStorageAdapter());
    profileMod.resetDeviceProfilesForTest();

    type StateLike = { status: string };
    type StubController = {
      onStateChange: (cb: (s: StateLike) => void) => () => void;
      getUnsafeAtConnect: () => unknown;
      sendCommand: (line: string, source?: string) => void;
      readonly sentCommands: string[];
      _emitState(state: StateLike): void;
    };

    function makeStub(verdict: unknown): StubController {
      let listener: ((s: StateLike) => void) | null = null;
      const sent: string[] = [];
      return {
        onStateChange(cb): () => void {
          listener = cb;
          return () => { listener = null; };
        },
        getUnsafeAtConnect(): unknown { return verdict; },
        sendCommand(line: string, _source?: string): void { sent.push(line); },
        get sentCommands(): string[] { return sent; },
        _emitState(state: StateLike): void { listener?.(state); },
      };
    }

    function makeService(stub: StubController): InstanceType<typeof MachineService> {
      const controllerRef = { current: stub as unknown };
      const portRef = { current: null as unknown };
      return new MachineService(
        controllerRef as never,
        portRef as never,
      );
    }

    function saveActive(autoM5: boolean | undefined): void {
      const blank = profileMod.createBlankProfile('Test');
      const next = autoM5 === undefined
        ? blank
        : { ...blank, autoM5OnConnect: autoM5 };
      profileMod.saveDeviceProfile(next);
      profileMod.setActiveProfileId(next.id);
    }

    // 5a. Profile opted-in + clean verdict + idle status → fires.
    {
      saveActive(true);
      const stub = makeStub(null);
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'idle' });
      assert(stub.sentCommands.includes('M5 S0'), 'Opt-in + clean verdict + idle: M5 S0 fired');
    }

    // 5b. Profile opt-out → no fire even on idle/clean.
    {
      saveActive(false);
      const stub = makeStub(null);
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'idle' });
      assert(stub.sentCommands.length === 0, 'Opt-out: no M5 fired');
    }

    // 5c. Profile opt-in + unsafe verdict (alarm) → no fire.
    {
      saveActive(true);
      const stub = makeStub({ reason: 'alarm' });
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'idle' });
      assert(!stub.sentCommands.includes('M5 S0'), 'Opt-in + unsafe verdict: M5 NOT fired');
    }

    // 5d. Profile opt-in + non-idle status (run) → no fire.
    {
      saveActive(true);
      const stub = makeStub(null);
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'run' });
      assert(
        !stub.sentCommands.includes('M5 S0'),
        'Opt-in + run state: M5 NOT fired (only idle triggers)',
      );
    }

    // 5e. One-shot: a second idle does not fire a second M5.
    {
      saveActive(true);
      const stub = makeStub(null);
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'idle' });
      stub._emitState({ status: 'idle' });
      const m5Count = stub.sentCommands.filter((l) => l === 'M5 S0').length;
      assert(m5Count === 1, 'One-shot: exactly 1 M5 fired even on repeated idle');
    }

    // 5f. Profile field undefined → no fire (default off).
    {
      saveActive(undefined);
      const stub = makeStub(null);
      const svc = makeService(stub);
      (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
      stub._emitState({ status: 'idle' });
      assert(stub.sentCommands.length === 0, 'Default (undefined): no M5 fired');
    }

    profileMod.resetDeviceProfilesForTest();
  }

  console.log(`\nT3-90 profile autoM5OnConnect: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
