/**
 * T3-70: origin/start-mode mini-map rendering.
 *
 * Run: npx tsx tests/job-layout-minimap.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  JobLayoutMiniMap,
  type JobLayoutMiniMapData,
} from '../src/ui/components/connection/JobLayoutMiniMap';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

async function renderMap(data: JobLayoutMiniMapData): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(JobLayoutMiniMap, { data }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => { root.unmount(); });
}

async function run(): Promise<void> {
  console.log('\n=== T3-70 job layout mini-map ===\n');

  {
    const { container, root } = await renderMap({
      bedWidth: 400,
      bedHeight: 300,
      startMode: 'absolute',
      originCorner: 'rear-right',
      materialBounds: { minX: 20, minY: 30, maxX: 220, maxY: 180 },
      jobBounds: { minX: 50, minY: 60, maxX: 120, maxY: 110 },
      frameBounds: { minX: 45, minY: 55, maxX: 125, maxY: 115 },
    });
    assert(container.querySelector('[data-testid="mini-map-bed"]') != null, 'renders bed rectangle');
    assert(container.querySelector('[data-testid="mini-map-material"]') != null, 'renders material rectangle');
    assert(container.querySelector('[data-testid="mini-map-job-bounds"]') != null, 'renders job extent rectangle');
    assert(container.querySelector('[data-testid="mini-map-frame-bounds"]') != null, 'renders frame rectangle');
    assert(
      container.querySelector('[data-testid="mini-map-origin-corner"]')?.getAttribute('data-origin-corner') === 'rear-right',
      'origin marker records active origin corner',
    );
    assert(container.textContent?.includes('Canvas position') === false, 'mode label stays in SVG aria label, not visual clutter');
    await cleanup(root);
  }

  {
    const { container, root } = await renderMap({
      bedWidth: 400,
      bedHeight: 400,
      startMode: 'current',
      originCorner: 'front-left',
      headPosition: { x: 12, y: 34 },
      savedOrigin: { x: 80, y: 90 },
    });
    assert(container.querySelector('[data-testid="mini-map-head-position"]') != null, 'current mode renders current head marker');
    assert(container.querySelector('[data-testid="mini-map-saved-origin"]') == null, 'current mode does not render saved-origin marker');
    await cleanup(root);
  }

  {
    const { container, root } = await renderMap({
      bedWidth: 400,
      bedHeight: 400,
      startMode: 'savedOrigin',
      originCorner: 'front-right',
      headPosition: { x: 12, y: 34 },
      savedOrigin: { x: 80, y: 90 },
    });
    assert(container.querySelector('[data-testid="mini-map-saved-origin"]') != null, 'saved-origin mode renders saved zero marker');
    assert(container.querySelector('[data-testid="mini-map-head-position"]') == null, 'saved-origin mode does not render head marker');
    await cleanup(root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
