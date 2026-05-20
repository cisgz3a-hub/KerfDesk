/**
 * F45-05-003: Box Studio generated parts must land on a cut-ready output layer.
 *
 * Run: npx tsx tests/box-generator-cut-layer-assignment.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createLayer, type Layer } from '../src/core/scene/Layer';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { compileJob } from '../src/core/job/JobCompiler';
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

function boxObject(layerId: string, name = 'Box: Front'): SceneObject {
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
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function sceneWithLayers(layers: Layer[], activeLayerId: string): Scene {
  return {
    ...createScene(100, 100, 'box layer proof'),
    layers,
    activeLayerId,
    objects: [],
  };
}

function Harness(props: {
  scene: Scene;
  onHandlers: (handlers: GeneratorHandlers) => void;
  onCommit: (scene: Scene, selection: ReadonlySet<string> | undefined) => void;
}) {
  const handlers = useGeneratorHandlers({
    scene: props.scene,
    selectedIds: new Set(),
    setSelectedIds: () => undefined,
    handleSceneCommit: (scene, _action, selectionAfter) => { props.onCommit(scene, selectionAfter); },
    setShowGridArray: () => undefined,
    setShowTemplates: () => undefined,
    showAlert: async () => undefined,
  });
  useEffect(() => { props.onHandlers(handlers); });
  return null;
}

async function runBoxGenerate(scene: Scene, objects: SceneObject[]): Promise<Scene> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let handlers: GeneratorHandlers | null = null;
  let committed: Scene | null = null;
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness, {
      scene,
      onHandlers: h => { handlers = h; },
      onCommit: s => { committed = s; },
    }));
  });
  assert(handlers != null, 'generator handlers mounted');
  await act(async () => { handlers?.handleBoxGenerate(objects); });
  await act(async () => { root.unmount(); });
  assert(committed != null, 'box generate commits a scene');
  return committed!;
}

function generatedLayers(scene: Scene): Layer[] {
  return scene.objects
    .filter(obj => obj.name.startsWith('Box'))
    .map(obj => scene.layers.find(layer => layer.id === obj.layerId))
    .filter((layer): layer is Layer => layer != null);
}

function allGeneratedOnCutOutputLayer(scene: Scene): boolean {
  const layers = generatedLayers(scene);
  return layers.length > 0
    && layers.every(layer => layer.settings.mode === 'cut'
      && layer.output === true
      && layer.visible === true
      && layer.locked === false);
}

async function run(): Promise<void> {
  console.log('\n=== F45-05-003 box generator cut layer assignment ===\n');

  {
    const cut = createLayer(0, 'cut', 'Cut');
    const engrave = createLayer(1, 'engrave', 'Engrave');
    const scene = sceneWithLayers([cut, engrave], engrave.id);
    const committed = await runBoxGenerate(scene, [boxObject(engrave.id)]);
    assert(allGeneratedOnCutOutputLayer(committed), 'active engrave layer redirects generated box parts to cut output layer');
    assert(committed.objects.every(obj => obj.layerId === cut.id), 'existing cut layer is reused');
    assert(compileJob(committed).operations.every(op => op.type === 'cut'), 'compiled generated box operations are cut operations');
  }

  {
    const offCut = createLayer(0, 'cut', 'Disabled Cut');
    offCut.output = false;
    const scene = sceneWithLayers([offCut], offCut.id);
    const committed = await runBoxGenerate(scene, [boxObject(offCut.id)]);
    const boxLayer = generatedLayers(committed)[0];
    assert(boxLayer != null && boxLayer.id !== offCut.id, 'output-off cut layer causes a new cut layer to be created');
    assert(allGeneratedOnCutOutputLayer(committed), 'new generated box layer is cut/output-on/visible/unlocked');
    assert(compileJob(committed).operations.every(op => op.type === 'cut'), 'compiled generated box operations cut after new layer creation');
  }

  {
    const cut = createLayer(0, 'cut', 'Cut');
    const scene = sceneWithLayers([cut], cut.id);
    const committed = await runBoxGenerate(scene, [boxObject(cut.id)]);
    assert(committed.objects.every(obj => obj.layerId === cut.id), 'valid active cut layer is preserved');
    assert(allGeneratedOnCutOutputLayer(committed), 'valid active cut layer remains cut-ready');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
