/**
 * F45-10-001: Kerf Wizard must generate a real inner-hole coupon.
 *
 * Run: npx tsx tests/kerf-wizard-coupon-geometry.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { PathGeometry, SceneObject, SubPath } from '../src/core/scene/SceneObject';
import { KerfWizard } from '../src/ui/components/KerfWizard';

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

function buttonByText(container: Element, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button'))
    .find(button => (button.textContent ?? '').includes(text)) ?? null;
}

async function clickButton(container: Element, text: string): Promise<void> {
  const button = buttonByText(container, text);
  assert(button != null, `${text} button exists`);
  if (!button) return;
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
}

function makeScene(): Scene {
  return {
    ...createScene(300, 300, 'kerf wizard coupon'),
    material: {
      type: 'wood',
      name: '300mm test sheet',
      width: 300,
      height: 300,
      x: 0,
      y: 0,
      thickness: 3,
      color: '#d9b382',
      enabled: true,
    },
  };
}

async function renderAndGenerateCoupon(): Promise<SceneObject[]> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  let generated: SceneObject[] = [];
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(KerfWizard, {
      scene: makeScene(),
      selectedIds: new Set<string>(),
      onGenerateTestPiece: objects => { generated = objects; },
      onApplyKerf: () => undefined,
      onSaveToPreset: () => undefined,
      onClose: () => undefined,
    }));
  });

  await clickButton(container, 'Start Kerf Test');
  await clickButton(container, 'Add to Canvas');
  await act(async () => { root.unmount(); });

  return generated;
}

function subPathBounds(subPath: SubPath): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of subPath.segments) {
    if (segment.type !== 'move' && segment.type !== 'line') continue;
    minX = Math.min(minX, segment.to.x);
    minY = Math.min(minY, segment.to.y);
    maxX = Math.max(maxX, segment.to.x);
    maxY = Math.max(maxY, segment.to.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function sortedClosedBounds(geometry: PathGeometry): ReturnType<typeof subPathBounds>[] {
  return geometry.subPaths
    .filter(subPath => subPath.closed)
    .map(subPathBounds)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
}

async function run(): Promise<void> {
  console.log('\n=== F45-10-001 Kerf Wizard coupon geometry ===\n');

  const generated = await renderAndGenerateCoupon();
  assert(generated.length >= 3, 'wizard emits calibration objects');

  const outerPiece = generated.find(object => /Kerf Test Outer/.test(object.name));
  assert(outerPiece?.geometry.type === 'rect', 'outer measurement piece remains a plain measurable square');

  const holeCoupon = generated.find(object => /Kerf Test Hole/.test(object.name));
  assert(holeCoupon != null, 'hole coupon object is generated');
  assert(holeCoupon?.geometry.type === 'path', 'hole coupon is compound path geometry, not a second plain square');

  if (holeCoupon?.geometry.type === 'path') {
    const bounds = sortedClosedBounds(holeCoupon.geometry);
    assert(bounds.length >= 2, 'hole coupon has closed outer and inner contours');
    const outer = bounds[0]!;
    const inner = bounds[bounds.length - 1]!;
    assert(inner.width > 29.9 && inner.width < 30.1, `inner hole width is the designed 30mm (got ${inner.width.toFixed(3)})`);
    assert(inner.height > 29.9 && inner.height < 30.1, `inner hole height is the designed 30mm (got ${inner.height.toFixed(3)})`);
    assert(outer.width > inner.width && outer.height > inner.height, 'outer coupon frame encloses the inner hole');
    assert(inner.minX > outer.minX && inner.maxX < outer.maxX, 'inner hole is horizontally inside the coupon frame');
    assert(inner.minY > outer.minY && inner.maxY < outer.maxY, 'inner hole is vertically inside the coupon frame');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
