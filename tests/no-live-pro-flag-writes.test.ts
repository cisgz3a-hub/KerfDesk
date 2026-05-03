/**
 * T1-82: legacy PRO_FLAG_KEY ('laserforge_pro') must not be written by
 * setState during normal entitlement state changes.
 *
 * Run: npx tsx tests/no-live-pro-flag-writes.test.ts
 */
import type { EntitlementState } from '../src/entitlements/types';
import { EntitlementService } from '../src/entitlements/EntitlementService';
import { setStorageForTest } from '../src/core/storage/storage';
import type { StorageAdapter } from '../src/core/storage/StorageAdapter';

const PRO_FLAG_KEY = 'laserforge_pro';

interface RecordedOp {
  kind: 'set' | 'remove';
  key: string;
  value?: string;
}

class RecordingStorage implements StorageAdapter {
  ops: RecordedOp[] = [];
  data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.ops.push({ kind: 'set', key, value });
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.ops.push({ kind: 'remove', key });
    this.data.delete(key);
  }
  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (!prefix) return keys;
    return keys.filter(k => k.startsWith(prefix));
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function run(): Promise<void> {
  console.log('\n=== T1-82 no live PRO_FLAG_KEY writes during setState ===\n');

  {
    const storage = new RecordingStorage();
    setStorageForTest(storage);
    const svc = new EntitlementService();

    storage.ops.length = 0;
    svc.skipToFreeSession();
    await Promise.resolve();
    await Promise.resolve();

    const proFlagOps = storage.ops.filter(op => op.key === PRO_FLAG_KEY);
    assert(
      proFlagOps.length === 0,
      `skipToFreeSession: no PRO_FLAG_KEY ops; got ${JSON.stringify(proFlagOps)}`,
    );
  }

  {
    const storage = new RecordingStorage();
    setStorageForTest(storage);
    const svc = new EntitlementService();

    storage.ops.length = 0;
    (
      svc as unknown as {
        setState(next: EntitlementState): void;
      }
    ).setState({
      tier: 'paid',
      hasPro: true,
      label: 'Pro Test',
    });
    await Promise.resolve();
    await Promise.resolve();

    const proFlagOps = storage.ops.filter(op => op.key === PRO_FLAG_KEY);
    assert(
      proFlagOps.length === 0,
      `setState({ hasPro: true }): no PRO_FLAG_KEY ops; got ${JSON.stringify(proFlagOps)}`,
    );
  }

  {
    const storage = new RecordingStorage();
    setStorageForTest(storage);
    const svc = new EntitlementService();

    (
      svc as unknown as {
        setState(next: EntitlementState): void;
      }
    ).setState({
      tier: 'paid',
      hasPro: true,
      label: 'Test',
    });
    await Promise.resolve();

    assert(svc.hasPro() === true, 'setState({ hasPro: true }): hasPro() is true');
  }

  setStorageForTest(null);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
