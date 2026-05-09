/**
 * T1-17 pass 3: importImageUnified must keep stable identity across scene mutations.
 *
 * Before this fix, useImport's importImageUnified callback was wrapped
 * in useCallback with [scene] in its deps array. Every scene mutation
 * minted a fresh function reference, which cascaded into re-renders of
 * every component depending on the import handlers (handleImageImport,
 * handleDrop).
 *
 * The fix moves scene reads behind a sceneRef synced via useEffect, so
 * importImageUnified can read the live scene without listing it as a
 * dep. The dep array drops to []. The function reference stays === across
 * scene mutations.
 *
 * Run: npx tsx tests/import-callback-identity-stable.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useImport, type UseImportDeps } from '../src/ui/hooks/useImport';
import { createScene, type Scene } from '../src/core/scene/Scene';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as { window?: Window }).window = win as unknown as Window;
(globalThis as { document?: Document }).document = win.document;
if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame !== 'function') {
  (globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
    (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

// Stable noop deps held across all renders so handleImageImport's
// identity hinges purely on importImageUnified's identity.
const noopDeps: UseImportDeps = {
  handleSceneCommit: () => {},
  handleNewProject: () => {},
  setIsDragOver: () => {},
  showAlert: () => Promise.resolve(),
  showConfirm: () => Promise.resolve(true),
  showChoice: () => Promise.resolve('laser'),
};

async function run(): Promise<void> {
  console.log('\n=== importImageUnified identity stable across scene mutations (T1-17 pass 3) ===\n');
  const container = win.document.getElementById('root')!;
  const root: Root = createRoot(container);

  const captures: Array<{ handleImageImport: unknown; handleDrop: unknown }> = [];

  function Harness({ scene }: { scene: Scene }): React.ReactElement {
    const { handleImageImport, handleDrop } = useImport(scene, noopDeps);
    captures.push({ handleImageImport, handleDrop });
    return React.createElement('div');
  }

  const sceneA = createScene(400, 300, 'A');
  const sceneB = createScene(400, 300, 'B');
  const sceneC = createScene(400, 300, 'C');

  await act(async () => {
    root.render(React.createElement(Harness, { scene: sceneA }));
  });
  await act(async () => {
    root.render(React.createElement(Harness, { scene: sceneB }));
  });
  await act(async () => {
    root.render(React.createElement(Harness, { scene: sceneC }));
  });

  assert(captures.length === 3, '3 renders captured (precondition)');
  assert(sceneA !== sceneB && sceneB !== sceneC && sceneA !== sceneC, 'three distinct scene objects (precondition)');

  assert(captures[0]!.handleImageImport === captures[1]!.handleImageImport, 'handleImageImport stable across scene A -> B');
  assert(captures[1]!.handleImageImport === captures[2]!.handleImageImport, 'handleImageImport stable across scene B -> C');
  assert(captures[0]!.handleImageImport === captures[2]!.handleImageImport, 'handleImageImport stable across scene A -> C (transitive)');

  // Sanity: handleDrop should still change because it has [scene] in its
  // deps directly. SVG/DXF import branches are outside this pass's scope.
  assert(captures[0]!.handleDrop !== captures[1]!.handleDrop, 'handleDrop intentionally changes across scenes');

  await act(async () => {
    root.unmount();
  });
}

run().then(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err: unknown) => {
  console.error('Test threw:', err);
  process.exit(1);
});
