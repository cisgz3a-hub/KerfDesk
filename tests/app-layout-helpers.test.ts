/**
 * T2-6 Phase 3w: regression test for the pure layout + connection-
 * status helpers extracted from App.tsx.
 *
 * Run: npx tsx tests/app-layout-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MachineState } from '../src/controllers/ControllerInterface';
import {
  computeCanvasSize,
  computeLayoutWidths,
  isLaserConnected,
} from '../src/ui/components/app/appLayoutHelpers';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function mkState(status: MachineState['status']): MachineState {
  return { status } as unknown as MachineState;
}

console.log('\n=== T2-6 Phase 3w app layout helpers ===\n');

// -------- isLaserConnected --------
{
  assert(!isLaserConnected(null), 'null → not connected');
  assert(!isLaserConnected(undefined), 'undefined → not connected');
  assert(!isLaserConnected(mkState('disconnected')),
    'disconnected → not connected');
  assert(!isLaserConnected(mkState('connecting')),
    'connecting → not connected (mid-handshake)');
  // Other statuses → connected
  assert(isLaserConnected(mkState('idle')), 'idle → connected');
  assert(isLaserConnected(mkState('run')), 'run → connected');
  assert(isLaserConnected(mkState('hold')), 'hold → connected');
  assert(isLaserConnected(mkState('alarm')), 'alarm → connected (still talking)');
  assert(isLaserConnected(mkState('door' as MachineState['status'])),
    'door → connected (interlock open, but talking)');
}

// -------- computeLayoutWidths: sidebar closed --------
{
  const r = computeLayoutWidths(1500, false);
  assert(r.connectionSidebarWidth === 0, 'closed → sidebar 0');
  assert(r.layersPanelWidth === 240, 'closed → layers panel = 240');
  assert(r.toolbarWidth === 36, 'toolbar = 36 (constant)');
  // viewport = 1500 - 36 - 0 - 240 = 1224
  assert(r.canvasViewportWidth === 1224,
    'viewport = canvas - toolbar - sidebar - layers (1500 → 1224)');
}

// -------- computeLayoutWidths: sidebar open, narrow canvas --------
{
  // 1000 × 0.45 = 450 → less than 500, so sidebar = 450
  const r = computeLayoutWidths(1000, true);
  assert(r.connectionSidebarWidth === 450,
    'open, 1000 wide → sidebar = 45% (450, under 500 cap)');
  assert(r.layersPanelWidth === 0, 'open → layers panel 0 (mutual exclusion)');
  // viewport = 1000 - 36 - 450 - 0 = 514
  assert(r.canvasViewportWidth === 514, 'viewport = 514');
}

// -------- computeLayoutWidths: sidebar open, wide canvas --------
{
  // 2000 × 0.45 = 900 → capped at 500
  const r = computeLayoutWidths(2000, true);
  assert(r.connectionSidebarWidth === 500,
    'open, 2000 wide → sidebar = 500 (capped, not 900)');
  // viewport = 2000 - 36 - 500 - 0 = 1464
  assert(r.canvasViewportWidth === 1464, 'viewport = 1464');
}

// -------- computeLayoutWidths: floor on 45% --------
{
  // 1111 × 0.45 = 499.95 → floor → 499
  const r = computeLayoutWidths(1111, true);
  assert(r.connectionSidebarWidth === 499,
    '45% of 1111 = 499.95 → floored to 499');
}

// -------- computeLayoutWidths: extremely narrow canvas (no clamp) --------
{
  // Sidebar closed, canvas only 200px → viewport = 200 - 36 - 0 - 240 = -76
  const r = computeLayoutWidths(200, false);
  assert(r.canvasViewportWidth === -76,
    'narrow canvas: viewport goes negative (no clamp — CSS handles overflow)');
}

// -------- computeCanvasSize --------
{
  const r = computeCanvasSize(1200, 900);
  assert(r.width === 1200, 'canvas size preserves viewport width');
  assert(r.height === 866, 'canvas size subtracts the app chrome height');
}

// -------- Source-level pin: App.tsx delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const appSrc = readFileSync(
    resolve(here, '../src/ui/components/App.tsx'),
    'utf-8',
  );
  assert(/from '\.\/app\/appLayoutHelpers'/.test(appSrc),
    'App imports from ./app/appLayoutHelpers');
  assert(/T2-6 Phase 3w|Phase 3w/.test(appSrc),
    'App.tsx carries Phase 3w marker');
  assert(/computeLayoutWidths\(canvasSize\.width, connectionSidebarOpen\)/.test(appSrc),
    'App calls computeLayoutWidths(canvasWidth, sidebarOpen)');
  assert(/isLaserConnected\(grbl\.machineState\)/.test(appSrc),
    'App calls isLaserConnected(machineState)');
  assert(/computeCanvasSize\(window\.innerWidth, window\.innerHeight\)/.test(appSrc),
    'App calls computeCanvasSize(window width, height)');
  // Inline `Math.min(500, Math.floor(canvasSize.width * 0.45))` is gone
  assert(!/Math\.min\(500, Math\.floor\(canvasSize\.width \* 0\.45\)\)/.test(appSrc),
    'inline 500/45% sidebar math is gone from App.tsx');
  // Inline status-disconnected/connecting check is gone
  assert(!/s\.status !== 'disconnected' && s\.status !== 'connecting'/.test(appSrc),
    'inline disconnect/connecting check is gone from App.tsx');
  assert(!/innerHeight - 34/.test(appSrc),
    'inline resize chrome subtraction is gone from App.tsx');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/app/appLayoutHelpers.ts'),
    'utf-8',
  );
  assert(/T2-6 Phase 3w|Phase 3w/.test(helperSrc),
    'appLayoutHelpers carries Phase 3w marker');
  assert(/export function computeLayoutWidths/.test(helperSrc),
    'computeLayoutWidths is exported');
  assert(/export function isLaserConnected/.test(helperSrc),
    'isLaserConnected is exported');
  assert(/export function computeCanvasSize/.test(helperSrc),
    'computeCanvasSize is exported');
  assert(/T2-6 Phase 3an|Phase 3an/.test(helperSrc),
    'appLayoutHelpers carries Phase 3an marker');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
