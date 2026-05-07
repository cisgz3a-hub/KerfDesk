/**
 * T2-32: explicit connection lifecycle state machine foundation.
 * Run: npx tsx tests/connection-manager-fsm.test.ts
 */
import {
  ConnectionManager,
  type ConnectionLifecycle,
} from '../src/app/ConnectionManager';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(): Promise<void> {
  console.log('\n=== T2-32 connection manager FSM ===\n');

  {
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-a' });
    const states: ConnectionLifecycle[] = [];
    manager.subscribe(state => states.push(state));
    await manager.connect({
      selectTransport: async () => 'transport-a',
      openTransport: async () => {},
      handshake: async () => 'controller-a',
    });
    assert(states.map(s => s.state).join('>') === 'selecting>opening>handshaking>ready',
      `connect emits selecting>opening>handshaking>ready (got ${states.map(s => s.state).join('>')})`);
    assert(manager.state.state === 'ready', 'manager ends ready after successful connect');
    assert(manager.state.state === 'ready' && manager.state.connectionId === 'conn-a', 'ready state carries connection id');
  }

  {
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-b' });
    await manager.connect({
      selectTransport: async () => 'transport-b',
      handshake: async () => 'controller-b',
    });
    const err = await manager.connect({
      selectTransport: async () => 'unused',
      handshake: async () => 'unused',
    }).then(
      () => null,
      caught => caught instanceof Error ? caught.message : String(caught),
    );
    assert(err?.includes('Cannot connect from state ready'), 'cannot connect from ready state');
  }

  {
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-c' });
    const states: string[] = [];
    manager.subscribe(state => states.push(state.state));
    let cleanupCalled = false;
    const err = await manager.connect({
      selectTransport: async () => 'transport-c',
      handshake: async () => {
        throw new Error('handshake failed');
      },
      cleanup: async ({ transport }) => {
        cleanupCalled = transport === 'transport-c';
      },
    }).then(
      () => null,
      caught => caught instanceof Error ? caught.message : String(caught),
    );
    assert(err === 'handshake failed', 'connect failure rejects with original error');
    assert(cleanupCalled, 'connect failure runs cleanup with transport');
    assert(manager.state.state === 'error', 'connect failure transitions to error state');
    assert(states.includes('error'), 'subscribers see error state');
  }

  {
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-d' });
    const states: string[] = [];
    let disconnectCalled = false;
    manager.subscribe(state => states.push(state.state));
    await manager.connect({
      selectTransport: async () => 'transport-d',
      handshake: async () => 'controller-d',
      disconnectReady: async ({ controller, transport }) => {
        disconnectCalled = controller === 'controller-d' && transport === 'transport-d';
      },
    });
    await manager.disconnect();
    assert(disconnectCalled, 'ready disconnect calls disconnectReady adapter');
    assert(states.slice(-2).join('>') === 'disconnecting>disconnected', 'ready disconnect emits disconnecting>disconnected');
    assert(manager.state.state === 'disconnected', 'manager ends disconnected after ready disconnect');
  }

  {
    const openGate = deferred<void>();
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-e' });
    const states: string[] = [];
    let sawAbort = false;
    manager.subscribe(state => states.push(state.state));
    const connectPromise = manager.connect({
      selectTransport: async () => 'transport-e',
      openTransport: async (_transport, signal) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          openGate.resolve();
        }, { once: true });
        await openGate.promise;
      },
      handshake: async () => 'controller-e',
    });
    await flush();
    await manager.disconnect();
    await connectPromise;
    assert(sawAbort, 'disconnect during opening aborts active connect signal');
    assert(!states.includes('ready'), 'disconnect during opening never reaches ready');
    assert(manager.state.state === 'disconnected', 'disconnect during opening ends disconnected');
  }

  {
    const manager = new ConnectionManager<string, string>({ idFactory: () => 'conn-f' });
    await manager.connect({
      selectTransport: async () => 'transport-f',
      handshake: async () => 'controller-f',
    });
    assert(!manager.isStaleConnection('conn-f'), 'active connection id is live');
    assert(manager.isStaleConnection('conn-old'), 'different connection id is stale');
    const err = (() => {
      try {
        manager.assertLiveConnection('conn-old');
        return null;
      } catch (caught) {
        return caught instanceof Error ? caught.message : String(caught);
      }
    })();
    assert(err?.includes('superseded'), 'assertLiveConnection throws for stale connection id');
  }

  {
    const manager = new ConnectionManager<string, string>();
    let called = 0;
    const oldWarn = console.warn;
    console.warn = () => {};
    manager.subscribe(() => {
      called++;
      throw new Error('listener crash');
    });
    manager.subscribe(() => {
      called++;
    });
    try {
      await manager.connect({
        selectTransport: async () => 'transport-g',
        handshake: async () => 'controller-g',
      });
    } finally {
      console.warn = oldWarn;
    }
    assert(called >= 2, 'throwing subscriber does not block later subscribers');
  }

  {
    const manager = new ConnectionManager<string, string>();
    manager.markStale('unsafe prior state');
    assert(manager.state.state === 'stale', 'markStale enters stale state');
    assert(manager.state.state === 'stale' && manager.state.reason === 'unsafe prior state', 'stale state carries reason');
  }

  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/app/ConnectionManager.ts'), 'utf8');
    assert(/T2-32/.test(src), 'T2-32 marker present');
    for (const state of ['disconnected', 'selecting', 'opening', 'handshaking', 'ready', 'disconnecting', 'error', 'stale']) {
      assert(src.includes(`'${state}'`), `state '${state}' declared`);
    }
    assert(/subscribe\(/.test(src), 'subscribe API declared');
    assert(/assertLiveConnection/.test(src), 'stale connection guard declared');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
