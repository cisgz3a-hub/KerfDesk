/**
 * useCompileManager should mark G-code stale once per stale span, not dispatch
 * repeatedly while the connection sidebar is open and scene ticks keep changing.
 * Run: npx tsx tests/usecompilemanager-stale-no-loop.test.tsx
 */
import './e2e/helpers/e2eDeterministicIds';

import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';
import {
  useCompileManager,
  type UseCompileManagerResult,
} from '../src/ui/hooks/useCompileManager';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as any).window = win;
(globalThis as any).document = win.document;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function flush(ms = 0): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function makeScene(name: string): Scene {
  const scene = createScene(400, 300, name);
  return addObject(scene, createRect(scene.layers[0].id, 20, 20, 40, 30));
}

function CompileHarness(props: {
  scene: Scene;
  onResult: (result: UseCompileManagerResult) => void;
}): React.ReactElement | null {
  const result = useCompileManager({
    scene: props.scene,
    startMode: 'current',
    savedOrigin: null,
    controllerMaxSpindle: null,
    machineBedFromController: null,
    controllerAccelMmPerS2: null,
    connectionSidebarOpen: true,
    outputFormat: 'grbl',
    isJobRunning: false,
  });
  useEffect(() => {
    props.onResult(result);
  });
  return null;
}

let root: Root | null = null;

async function unmountRoot(): Promise<void> {
  if (!root) return;
  await act(async () => {
    root!.unmount();
    await flush();
  });
  root = null;
}

async function run(): Promise<void> {
  console.log('\n=== usecompilemanager-stale-no-loop ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('UseCompileManagerNoLoop');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const errLogs: string[] = [];
  const expectedConsoleErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (/G-code compilation failed/.test(message)) {
      expectedConsoleErrors.push(message);
      return;
    }
    errLogs.push(message);
  };

  let hookResult: UseCompileManagerResult | null = null;
  try {
    const container = win.document.getElementById('root')!;
    await unmountRoot();
    root = createRoot(container);

    const initialScene = makeScene('CompiledScene');
    await act(async () => {
      root!.render(
        React.createElement(CompileHarness, {
          scene: initialScene,
          onResult: r => {
            hookResult = r;
          },
        }),
      );
      await flush();
    });

    let compiled: unknown = null;
    await act(async () => {
      compiled = await hookResult!.compileGcode(initialScene);
      await flush();
    });
    assert(compiled != null, 'initial compile succeeded');

    for (let i = 0; i < 75; i++) {
      await act(async () => {
        root!.render(
          React.createElement(CompileHarness, {
            scene: makeScene(`ChurnScene${i}`),
            onResult: r => {
              hookResult = r;
            },
          }),
        );
        await flush();
      });
    }
  } finally {
    console.error = originalError;
    await unmountRoot();
  }

  assert(
    !errLogs.some(m => m.includes('Maximum update depth exceeded')),
    'no React maximum update depth error during stale compile churn',
  );
  const actWarnings = errLogs.filter(m => m.includes('act(...)'));
  assert(
    actWarnings.length === 0,
    'stale compile churn test does not leak React act(...) warnings',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
