/**
 * F45-05-004: Box Studio should warn/block before inserting layouts that
 * cannot fit the current material/canvas bounds.
 *
 * Run: npx tsx tests/box-generator-fit-warning.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { useGeneratorHandlers, type GeneratorHandlers } from '../src/ui/hooks/useGeneratorHandlers';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function boxObject(layerId: string, sizeMm: number, name = 'Box: Test Face'): SceneObject {
  return {
    id: generateId(),
    type: 'polygon',
    name,
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: {
      type: 'polygon',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: sizeMm, y: 0 },
        { x: sizeMm, y: sizeMm },
        { x: 0, y: sizeMm },
      ],
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function Harness(props: {
  scene: Scene;
  onHandlers: (handlers: GeneratorHandlers) => void;
  onCommit: (scene: Scene, selection: ReadonlySet<string> | undefined) => void;
  onSelection: (selection: ReadonlySet<string>) => void;
  onAlert: (title: string, message: string) => void;
}) {
  const handlers = useGeneratorHandlers({
    scene: props.scene,
    selectedIds: new Set(),
    setSelectedIds: props.onSelection,
    handleSceneCommit: (scene, _action, selectionAfter) => { props.onCommit(scene, selectionAfter); },
    setShowGridArray: () => undefined,
    setShowTemplates: () => undefined,
    showAlert: async (title, message) => { props.onAlert(title, message); },
  });
  useEffect(() => { props.onHandlers(handlers); });
  return null;
}

async function runBoxGenerate(scene: Scene, objects: SceneObject[]): Promise<{
  committed: Scene | null;
  selection: ReadonlySet<string> | undefined;
  alerts: Array<{ title: string; message: string }>;
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let handlers: GeneratorHandlers | null = null;
  let committed: Scene | null = null;
  let selection: ReadonlySet<string> | undefined;
  const alerts: Array<{ title: string; message: string }> = [];
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness, {
      scene,
      onHandlers: h => { handlers = h; },
      onCommit: (next, ids) => {
        committed = next;
        selection = ids;
      },
      onSelection: ids => {
        selection = ids;
      },
      onAlert: (title, message) => { alerts.push({ title, message }); },
    }));
  });
  assert(handlers != null, 'generator handlers mounted');
  await act(async () => { handlers?.handleBoxGenerate(objects); });
  await act(async () => { root.unmount(); });
  return { committed, selection, alerts };
}

async function run(): Promise<void> {
  console.log('\n=== F45-05-004 box generated layout fit warning ===\n');

  {
    const scene = createScene(100, 100, 'small canvas box fit');
    const layerId = scene.layers[0]!.id;
    const result = await runBoxGenerate(scene, [boxObject(layerId, 200, 'Box: Oversized')]);
    assert(result.committed === null, 'oversized box layout is not inserted');
    assert(result.selection == null, 'oversized box layout is not selected');
    assert(result.alerts[0]?.title === 'Box Layout Too Large', 'oversized box layout shows a fit warning');
    assert(/exceeds the current material or canvas/i.test(result.alerts[0]?.message ?? ''),
      'fit warning explains that the generated box exceeds available bounds');
  }

  {
    const scene = createScene(100, 100, 'small canvas box fit');
    const layerId = scene.layers[0]!.id;
    const result = await runBoxGenerate(scene, [boxObject(layerId, 40, 'Box: Fits')]);
    assert(result.committed?.objects.length === 1, 'fitting box layout is inserted normally');
    assert(result.selection?.size === 1, 'fitting box layout is selected after insertion');
    assert(result.alerts.length === 0, 'fitting box layout does not show a warning');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
