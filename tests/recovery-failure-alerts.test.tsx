/**
 * T1-70: handleRecover must surface failures to the user via showAlert
 * instead of swallowing into console.error and unconditionally hiding the
 * recovery prompt. Verifies these branches:
 *   1. Empty/missing autosave -> "Recovery unavailable" alert + prompt hidden
 *   2. Corrupt autosave JSON -> "Recovery failed" alert + prompt KEPT visible
 *   3. Atomic autosave record checksum mismatch -> prompt KEPT visible
 *   4. Embedded project checksum mismatch -> prompt KEPT visible
 *   5. Successful recover -> no alert, prompt hidden, handleNewProject fired
 *
 * Run: npx tsx tests/recovery-failure-alerts.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWizardHandlers, type WizardHandlers } from '../src/ui/hooks/useWizardHandlers';
import { setStorageForTest } from '../src/core/storage/storage';
import { resetAutosaveForTest, writeAutosaveAsync } from '../src/app/autosavePersistence';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { createScene } from '../src/core/scene/Scene';
import { serializeForAutosave, serializeScene } from '../src/io/SceneSerializer';

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

interface AlertCall { title: string; message: string }
interface HarnessControls {
  alerts: AlertCall[];
  showRecoverCalls: boolean[];
  newProjectCalls: number;
  recoverTimeLabelCalls: (string | null)[];
}

function makeControls(): HarnessControls {
  return {
    alerts: [],
    showRecoverCalls: [],
    newProjectCalls: 0,
    recoverTimeLabelCalls: [],
  };
}

function tamperSceneChecksum(json: string): string {
  const envelope = JSON.parse(json) as {
    scene?: { metadata?: { name?: string } };
  };
  if (!envelope.scene?.metadata) {
    throw new Error('test fixture is missing scene metadata');
  }
  envelope.scene.metadata.name = 'Tampered Autosave';
  return JSON.stringify(envelope);
}

function Harness(props: {
  controls: HarnessControls;
  onHandlers: (h: WizardHandlers) => void;
}): React.ReactElement | null {
  const handlers = useWizardHandlers({
    scene: createScene(400, 300, 'test'),
    handleSceneCommit: () => undefined,
    handleNewProject: () => { props.controls.newProjectCalls += 1; },
    setShowSetup: () => undefined,
    setShowRecover: (v: boolean) => { props.controls.showRecoverCalls.push(v); },
    setRecoverAutosaveTimeLabel: (l: string | null) => { props.controls.recoverTimeLabelCalls.push(l); },
    viewportActionsRef: { current: null },
    refreshProfiles: () => undefined,
    showAlert: async (title: string, message: string) => {
      props.controls.alerts.push({ title, message });
    },
  });
  useEffect(() => { props.onHandlers(handlers); });
  return null;
}

let root: Root | null = null;

async function renderAndGetHandlers(controls: HarnessControls): Promise<WizardHandlers> {
  const container = win.document.getElementById('root')!;
  if (root) {
    await act(async () => { root!.unmount(); });
  }
  root = createRoot(container);
  let captured: WizardHandlers | null = null;
  await act(async () => {
    root!.render(
      React.createElement(Harness, {
        controls,
        onHandlers: h => { captured = h; },
      }),
    );
  });
  return captured!;
}

async function run(): Promise<void> {
  console.log('\n=== T1-70 recovery-failure-alerts ===\n');

  const errLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errLogs.push(args.map(String).join(' '));
  };

  try {
    // --- Branch 1: empty storage ---
    {
      const storage = new InMemoryStorageAdapter();
      setStorageForTest(storage);
      resetAutosaveForTest();
      const controls = makeControls();
      const handlers = await renderAndGetHandlers(controls);
      await act(async () => { await handlers.handleRecover(); });

      assert(controls.alerts.length === 1, 'empty storage: showAlert called exactly once');
      assert(
        controls.alerts[0]?.title === 'Recovery unavailable',
        'empty storage: alert title is "Recovery unavailable"',
      );
      assert(
        controls.showRecoverCalls.includes(false),
        'empty storage: setShowRecover(false) called (prompt hidden)',
      );
      assert(
        controls.newProjectCalls === 0,
        'empty storage: handleNewProject NOT called',
      );
    }

    // --- Branch 2: corrupt autosave JSON ---
    {
      const storage = new InMemoryStorageAdapter();
      await storage.set('laserforge_autosave', '{"this":"is not a valid LaserForge scene"');
      await storage.set('laserforge_autosave_time', new Date().toISOString());
      setStorageForTest(storage);
      resetAutosaveForTest();
      const controls = makeControls();
      const handlers = await renderAndGetHandlers(controls);
      await act(async () => { await handlers.handleRecover(); });

      assert(controls.alerts.length === 1, 'corrupt JSON: showAlert called exactly once');
      assert(
        controls.alerts[0]?.title === 'Recovery failed',
        'corrupt JSON: alert title is "Recovery failed"',
      );
      assert(
        !controls.showRecoverCalls.includes(false),
        'corrupt JSON: setShowRecover(false) NOT called — prompt stays visible for retry',
      );
      assert(
        controls.newProjectCalls === 0,
        'corrupt JSON: handleNewProject NOT called',
      );
      assert(
        errLogs.some(l => l.includes('Recovery failed')),
        'corrupt JSON: console.error was logged for support diagnosis',
      );
    }

    // --- Branch 3: atomic autosave record checksum mismatch ---
    {
      const goodScene = createScene(400, 300, 'record checksum mismatch');
      const goodJson = serializeForAutosave(goodScene);
      const storage = new InMemoryStorageAdapter();
      await storage.set('laserforge_autosave_record', JSON.stringify({
        version: 1,
        json: goodJson,
        timestamp: new Date().toISOString(),
        checksum: '00000000',
      }));
      setStorageForTest(storage);
      resetAutosaveForTest();
      const controls = makeControls();
      const handlers = await renderAndGetHandlers(controls);
      await act(async () => { await handlers.handleRecover(); });

      assert(controls.alerts.length === 1, 'record checksum mismatch: showAlert called exactly once');
      assert(
        controls.alerts[0]?.title === 'Recovery failed',
        'record checksum mismatch: alert title is "Recovery failed"',
      );
      assert(
        /checksum|integrity/i.test(controls.alerts[0]?.message ?? ''),
        'record checksum mismatch: alert explains the integrity failure',
      );
      assert(
        !controls.showRecoverCalls.includes(false),
        'record checksum mismatch: setShowRecover(false) NOT called - prompt stays visible',
      );
      assert(
        controls.newProjectCalls === 0,
        'record checksum mismatch: handleNewProject NOT called',
      );
    }

    // --- Branch 4: scene checksum mismatch inside an otherwise valid autosave record ---
    {
      const goodScene = createScene(400, 300, 'scene checksum mismatch');
      const tamperedJson = tamperSceneChecksum(serializeForAutosave(goodScene));
      const storage = new InMemoryStorageAdapter();
      setStorageForTest(storage);
      resetAutosaveForTest();
      await writeAutosaveAsync(tamperedJson);
      resetAutosaveForTest();
      const controls = makeControls();
      const handlers = await renderAndGetHandlers(controls);
      await act(async () => { await handlers.handleRecover(); });

      assert(controls.alerts.length === 1, 'scene checksum mismatch: showAlert called exactly once');
      assert(
        controls.alerts[0]?.title === 'Recovery failed',
        'scene checksum mismatch: alert title is "Recovery failed"',
      );
      assert(
        /checksum|integrity/i.test(controls.alerts[0]?.message ?? ''),
        'scene checksum mismatch: alert explains the integrity failure',
      );
      assert(
        !controls.showRecoverCalls.includes(false),
        'scene checksum mismatch: setShowRecover(false) NOT called - prompt stays visible',
      );
      assert(
        controls.newProjectCalls === 0,
        'scene checksum mismatch: handleNewProject NOT called',
      );
    }

    // --- Branch 5: successful recover ---
    {
      const goodScene = createScene(400, 300, 'recovered');
      const storage = new InMemoryStorageAdapter();
      await storage.set('laserforge_autosave', serializeScene(goodScene));
      await storage.set('laserforge_autosave_time', new Date().toISOString());
      setStorageForTest(storage);
      resetAutosaveForTest();
      const controls = makeControls();
      const handlers = await renderAndGetHandlers(controls);
      await act(async () => { await handlers.handleRecover(); });

      assert(controls.alerts.length === 0, 'successful: showAlert NOT called');
      assert(
        controls.showRecoverCalls.includes(false),
        'successful: setShowRecover(false) called (prompt hidden)',
      );
      assert(
        controls.newProjectCalls === 1,
        'successful: handleNewProject called exactly once',
      );
    }
  } finally {
    console.error = originalError;
    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
    setStorageForTest(null);
    resetAutosaveForTest();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
