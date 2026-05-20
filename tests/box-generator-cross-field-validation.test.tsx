/**
 * F45-05-002: Box Studio must validate cross-field dimensions before
 * render-time generation can throw.
 *
 * Run: npx tsx tests/box-generator-cross-field-validation.test.tsx
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { validateBoxGenerationParams } from '../src/core/box/boxGeometryV2';
import { BoxGeneratorControls } from '../src/ui/components/box-library/BoxGeneratorControls';
import { BoxStudioWorkspace } from '../src/ui/components/box-library/BoxStudioWorkspace';
import { createScene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
Object.defineProperty(win.HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    setTransform: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fillText: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  }),
  configurable: true,
});
if (typeof (win.HTMLElement.prototype as { attachEvent?: unknown }).attachEvent !== 'function') {
  Object.defineProperty(win.HTMLElement.prototype, 'attachEvent', { value: () => {}, configurable: true });
}
if (typeof (win.HTMLElement.prototype as { detachEvent?: unknown }).detachEvent !== 'function') {
  Object.defineProperty(win.HTMLElement.prototype, 'detachEvent', { value: () => {}, configurable: true });
}

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

function createButton(container: HTMLElement): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')]
    .find(button => /^Create \d-Face Box$/.test(button.textContent ?? '')) as HTMLButtonElement | null;
}

async function mountWorkspace(onGenerate: (objects: SceneObject[]) => void): Promise<{
  container: HTMLElement;
  root: Root;
  getCreateHandler: () => (() => void) | null;
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let createHandler: (() => void) | null = null;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BoxStudioWorkspace, {
      scene: createScene(100, 100, 'box validation'),
      onGenerate,
      onRegisterCreate: handler => { createHandler = handler; },
    }));
  });
  return { container, root, getCreateHandler: () => createHandler };
}

async function run(): Promise<void> {
  console.log('\n=== F45-05-002 box generator cross-field validation ===\n');

  {
    const invalidParams = {
      width: 10,
      height: 10,
      depth: 10,
      thickness: 20,
      fingerWidth: 3,
      openTop: false,
      kerf: 0.1,
      fitAllowance: 0.05,
      tabExtraDepth: 0.2,
      slotExtraDepth: 0.35,
      cornerRelief: 'none' as const,
    };
    const validation = validateBoxGenerationParams(invalidParams);
    assert(validation.ok === false, 'invalid cross-field box dimensions are rejected before generation');

    const container = win.document.getElementById('root')!;
    container.innerHTML = '';
    let generateCount = 0;
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(BoxGeneratorControls, {
        ...invalidParams,
        dimensionMode: 'outside',
        resolved: { width: invalidParams.width, height: invalidParams.height, depth: invalidParams.depth },
        faces: [],
        validationErrors: validation.errors,
        sourceText: 'Invalid test setup',
        onWidthChange: () => undefined,
        onHeightChange: () => undefined,
        onDepthChange: () => undefined,
        onThicknessChange: () => undefined,
        onFingerWidthChange: () => undefined,
        onKerfChange: () => undefined,
        onFitAllowanceChange: () => undefined,
        onTabExtraDepthChange: () => undefined,
        onSlotExtraDepthChange: () => undefined,
        onOpenTopChange: () => undefined,
        onDimensionModeChange: () => undefined,
        onGenerate: () => { generateCount++; },
      }));
    });
    assert(/too small for the selected material and joint settings/i.test(container.textContent ?? ''),
      'invalid cross-field dimensions show validation copy');
    const button = createButton(container);
    assert(button != null && button.disabled === true, 'Create box is disabled for invalid cross-field dimensions');
    await act(async () => { button?.click(); });
    assert(generateCount === 0, 'disabled Create button refuses invalid cross-field dimensions');
    await act(async () => { root.unmount(); });
  }

  {
    const generated: SceneObject[][] = [];
    const { root, getCreateHandler } = await mountWorkspace(objects => { generated.push(objects); });
    await act(async () => { getCreateHandler()?.(); });
    assert(generated[0]?.length === 6, 'valid default dimensions still generate box geometry');
    await act(async () => { root.unmount(); });
  }

  {
    const workspaceSource = readFileSync(resolve(process.cwd(), 'src/ui/components/box-library/BoxStudioWorkspace.tsx'), 'utf-8');
    assert(workspaceSource.includes('if (!boxValidation.ok) return;'), 'registered Create handler refuses invalid validation state');
    assert(workspaceSource.includes('validationErrors: boxValidation.errors'), 'Box Studio passes validation errors to the controls');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
