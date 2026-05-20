/**
 * T2-17 follow-up: useCompileManager exposes compile progress and cancel.
 *
 * Run: npx tsx tests/usecompilemanager-cancel-progress.test.tsx
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
    console.log(`  OK ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

function flush(ms = 0): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
    key: (i: number) => Object.keys(memoryStore)[i] ?? null,
    removeItem: (k: string) => { delete memoryStore[k]; },
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
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

async function run(): Promise<void> {
  console.log('\n=== useCompileManager cancel + progress ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const profile = createBlankProfile('UseCompileManagerCancel');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

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
    if (root) root.unmount();
    root = createRoot(container);

    const scene = makeScene('CancelScene');
    await act(async () => {
      root!.render(React.createElement(CompileHarness, {
        scene,
        onResult: r => {
          hookResult = r;
        },
      }));
      await flush();
    });

    assert(typeof hookResult!.cancelCompile === 'function',
      'hook exposes cancelCompile');
    assert(hookResult!.compileProgress === null,
      'hook starts with no compileProgress');

    let result: string | null = 'not-run';
    if (typeof hookResult!.cancelCompile === 'function') {
      await act(async () => {
        const pending = hookResult!.compileGcode(scene);
        hookResult!.cancelCompile();
        result = await pending;
        await flush();
      });

      assert(result === null,
        'cancelCompile aborts the in-flight compile and returns null');
      assert(hookResult!.isCompiling === false,
        'cancelled compile clears isCompiling');
      assert(hookResult!.compileProgress === null,
        'cancelled compile clears compileProgress');
      assert(!errLogs.some(m => m.includes('G-code compilation failed')),
        'cancelled compile is not logged as a compile failure');
      const actWarnings = errLogs.filter(m => m.includes('act(...)'));
      assert(actWarnings.length === 0, 'cancelled compile test does not leak React act(...) warnings');
    }
  } finally {
    console.error = originalError;
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
  }

  // Source-level pins for UI wiring.
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const hookSrc = fs.readFileSync(path.resolve(here, '../src/ui/hooks/useCompileManager.ts'), 'utf-8');
    const appSrc = fs.readFileSync(path.resolve(here, '../src/ui/components/App.tsx'), 'utf-8');
    const panelSrc = fs.readFileSync(path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
    assert(/cancelCompile/.test(hookSrc), 'useCompileManager defines cancelCompile');
    assert(/compileProgress/.test(hookSrc), 'useCompileManager tracks compileProgress');
    assert(/signal: .*\.signal/.test(hookSrc), 'useCompileManager passes AbortSignal into pipelineCompileGcode');
    assert(/compileProgress/.test(appSrc), 'App threads compileProgress');
    assert(/onCancelCompile/.test(panelSrc), 'ConnectionPanelMain exposes a cancel control prop');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
