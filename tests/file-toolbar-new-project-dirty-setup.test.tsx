/**
 * F45-03-001: Toolbar New must use the same broad dirty predicate as
 * keyboard New. A zero-object scene can still contain recovery-worthy
 * setup state (custom layers, material, machine/profile choices), so
 * object count alone is not enough.
 *
 * Run: npx tsx tests/file-toolbar-new-project-dirty-setup.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';
import { FileToolbar } from '../src/ui/components/FileToolbar';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as unknown as { window: Window }).window = win as unknown as Window;
(globalThis as unknown as { document: Document }).document = win.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | null = null;

interface HarnessResult {
  readonly container: HTMLDivElement;
  readonly counters: {
    confirms: number;
    newProjects: number;
  };
}

function setupOnlyScene(): Scene {
  const scene = createScene(320, 240, 'Setup Only');
  const custom = createLayer(1, 'score', 'Setup Layer');
  return {
    ...scene,
    layers: [...scene.layers, custom],
    material: {
      type: 'wood',
      name: '3mm Birch',
      width: 300,
      height: 200,
      x: 10,
      y: 10,
      thickness: 3,
      color: '#deb887',
    },
    machine: {
      name: 'Bench Diode',
      watts: '10W',
      type: 'diode',
    },
  };
}

async function renderToolbar(
  scene: Scene,
  options: {
    isSceneDirty?: () => boolean;
    confirmResult?: boolean;
  } = {},
): Promise<HarnessResult> {
  const container = win.document.getElementById('root') as HTMLDivElement;
  if (root) {
    await act(async () => { root!.unmount(); });
  }
  root = createRoot(container);
  const counters = { confirms: 0, newProjects: 0 };

  await act(async () => {
    root!.render(React.createElement(FileToolbar as React.ComponentType<any>, {
      scene,
      compileGcode: async () => '',
      onSceneChange: () => undefined,
      onSceneCommit: () => undefined,
      onNewProject: () => { counters.newProjects += 1; },
      showAlert: async () => undefined,
      showConfirm: async () => {
        counters.confirms += 1;
        return options.confirmResult ?? false;
      },
      showChoice: async () => null,
      isSceneDirty: options.isSceneDirty,
    }));
  });

  return { container, counters };
}

function findNewButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim() === 'New',
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error('New button not found');
  return button;
}

async function clickNew(container: HTMLElement): Promise<void> {
  const button = findNewButton(container);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

async function run(): Promise<void> {
  console.log('\n=== F45-03-001 FileToolbar New dirty setup ===\n');

  // -------- 1. Dirty zero-object setup prompts and cancel prevents reset --------
  {
    const { container, counters } = await renderToolbar(setupOnlyScene(), {
      isSceneDirty: () => true,
      confirmResult: false,
    });
    await clickNew(container);
    assert(counters.confirms === 1, 'dirty zero-object setup asks for New confirmation');
    assert(counters.newProjects === 0, 'declining confirmation does not create a new project');
  }

  // -------- 2. Clean zero-object scene can still start new without prompt --------
  {
    const { container, counters } = await renderToolbar(createScene(320, 240, 'Clean'), {
      isSceneDirty: () => false,
    });
    await clickNew(container);
    assert(counters.confirms === 0, 'clean zero-object scene does not prompt');
    assert(counters.newProjects === 1, 'clean zero-object scene creates a new project');
  }

  // -------- 3. Legacy fallback still prompts when objects exist and no predicate is supplied --------
  {
    const scene = createScene(320, 240, 'Objects');
    const withObject = {
      ...scene,
      objects: [{ ...createRect(scene.activeLayerId, 0, 0, 10, 10, 'Rect'), id: 'rect-1' }],
    };
    const { container, counters } = await renderToolbar(withObject, { confirmResult: false });
    await clickNew(container);
    assert(counters.confirms === 1, 'object-containing fallback still asks for New confirmation');
    assert(counters.newProjects === 0, 'object-containing fallback honors cancelled confirmation');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (root) {
    await act(async () => { root!.unmount(); });
  }
  if (failed > 0) process.exit(1);
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
