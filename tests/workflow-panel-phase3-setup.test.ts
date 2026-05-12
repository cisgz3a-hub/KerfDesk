/**
 * T1-207 (Phase 3): regression test for the `setup` mode + its
 * three tabs (Move / Job / Console) + tab persistence.
 *
 * Pinning approach matches Phase 2: the tab components reuse
 * existing React-heavy bodies (Jog, ConsolePanel,
 * DeviceProfileSelector) that aren't render-testable in tsx
 * without JSDOM. Instead this test exercises:
 *
 *   - `setupTabPersistence` round-trips through localStorage with
 *     the right key and default value.
 *   - Every tab component file exists, carries the T1-207 marker,
 *     and imports the existing component it's meant to reuse.
 *   - `SetupMode` wires `TabBar` + the three tab components and
 *     consults the persistence helper for the initial active
 *     tab.
 *   - `WorkflowPanel` routes the `setup` mode to `SetupMode` when
 *     `setupModeProps` is supplied AND falls back to `ModeStub`
 *     when it's null.
 *   - `ConnectionPanel.tsx` adapter builds `setupModeProps` with
 *     the expected wirings (jog → executionCoordinator.jog with a
 *     feed default, home → executionCoordinator.home,
 *     sendUserCommand → machineService.sendCommand with the
 *     safe-only carve-out).
 *
 * Run: npx tsx tests/workflow-panel-phase3-setup.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSetupTab,
  writeSetupTab,
  ALL_SETUP_TABS,
  SETUP_TAB_STORAGE_KEY,
  SETUP_TAB_DEFAULT,
  type SetupTab,
} from '../src/ui/components/workflow/modes/setup/setupTabPersistence';

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

const here = dirname(fileURLToPath(import.meta.url));

// Mock localStorage so the persistence helper has somewhere to
// read/write to.
const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

function resetStore(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

console.log('\n=== T1-207 WorkflowPanel Phase 3 setup mode ===\n');

// -------- 1. setupTabPersistence constants --------
{
  assert(
    SETUP_TAB_STORAGE_KEY === 'laserforge.ui.setup-tab',
    'storage key is laserforge.ui.setup-tab',
  );
  assert(SETUP_TAB_DEFAULT === 'move', "default tab is 'move'");
  assert(ALL_SETUP_TABS.length === 3, '3 tabs declared');
  const tabs = new Set(ALL_SETUP_TABS);
  assert(tabs.has('move') && tabs.has('job') && tabs.has('console'),
    'tabs are move + job + console');
}

// -------- 2. readSetupTab returns the default with empty storage --------
{
  resetStore();
  assert(readSetupTab() === 'move', "empty storage → default 'move'");
}

// -------- 3. writeSetupTab + readSetupTab round-trip --------
{
  for (const tab of ALL_SETUP_TABS) {
    resetStore();
    writeSetupTab(tab);
    assert(readSetupTab() === tab, `round-trip '${tab}'`);
    assert(
      memoryStore[SETUP_TAB_STORAGE_KEY] === tab,
      `storage value matches for '${tab}'`,
    );
  }
}

// -------- 4. Invalid storage values fall back to default --------
{
  resetStore();
  memoryStore[SETUP_TAB_STORAGE_KEY] = 'NOPE';
  assert(readSetupTab() === 'move', 'invalid storage → default');
  memoryStore[SETUP_TAB_STORAGE_KEY] = '';
  assert(readSetupTab() === 'move', 'empty string storage → default');
}

// -------- 5. SetupTab union is exactly the 3 expected values --------
{
  const allTyped: ReadonlyArray<SetupTab> = ['move', 'job', 'console'];
  assert(allTyped.length === 3, 'SetupTab union covers all three tabs');
}

// -------- 6. Source pins on the tab components --------
{
  const moveSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/setup/MoveTab.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(moveSrc), 'MoveTab.tsx carries T1-207 marker');
  assert(
    /import \{ Jog \} from '\.\.\/\.\.\/\.\.\/connection\/Jog'/.test(moveSrc),
    'MoveTab imports the existing Jog component',
  );
  assert(
    /React\.createElement\(Jog/.test(moveSrc),
    'MoveTab renders the Jog component',
  );

  const jobSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/setup/JobTab.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(jobSrc), 'JobTab.tsx carries T1-207 marker');
  assert(/activeProfile/.test(jobSrc), 'JobTab surfaces activeProfile');
  assert(/resolvedBedWidthMm/.test(jobSrc), 'JobTab surfaces bed dimensions');
  assert(
    /gcodeStale.*onRecompile|onRecompile.*gcodeStale/s.test(jobSrc),
    'JobTab wires gcodeStale + onRecompile',
  );

  const consoleSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/setup/ConsoleTab.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(consoleSrc), 'ConsoleTab.tsx carries T1-207 marker');
  assert(
    /import \{ ConsolePanel \} from '\.\.\/\.\.\/\.\.\/ConsolePanel'/.test(consoleSrc),
    'ConsoleTab imports the existing ConsolePanel component',
  );
  assert(
    /React\.createElement\(ConsolePanel/.test(consoleSrc),
    'ConsoleTab renders the ConsolePanel component',
  );
}

// -------- 7. SetupMode top-level component --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/SetupMode.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(src), 'SetupMode.tsx carries T1-207 marker');
  // Imports each tab component.
  assert(/import \{ MoveTab \}/.test(src), 'SetupMode imports MoveTab');
  assert(/import \{ JobTab \}/.test(src), 'SetupMode imports JobTab');
  assert(/import \{ ConsoleTab \}/.test(src), 'SetupMode imports ConsoleTab');
  assert(/import \{ TabBar \}/.test(src), 'SetupMode imports TabBar');
  // Tab persistence is consulted for initial state.
  assert(
    /useState[\s\S]{0,60}readSetupTab\(\)/.test(src),
    'SetupMode initializes active tab from readSetupTab()',
  );
  // Persists every change.
  assert(
    /useEffect[\s\S]{0,120}writeSetupTab\(activeTab\)/.test(src),
    'SetupMode persists active tab via writeSetupTab in useEffect',
  );
  // Switch statement routes to each tab body.
  assert(
    /case 'move'[\s\S]{0,500}React\.createElement\(MoveTab/.test(src),
    "SetupMode renders MoveTab when active='move'",
  );
  assert(
    /case 'job'[\s\S]{0,500}React\.createElement\(JobTab/.test(src),
    "SetupMode renders JobTab when active='job'",
  );
  assert(
    /case 'console'[\s\S]{0,500}React\.createElement\(ConsoleTab/.test(src),
    "SetupMode renders ConsoleTab when active='console'",
  );
}

// -------- 8. TabBar pure component --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/setup/TabBar.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(src), 'TabBar.tsx carries T1-207 marker');
  assert(/role: 'tablist'/.test(src), 'TabBar has tablist role on the container');
  assert(/role: 'tab'/.test(src), 'TabBar buttons have tab role');
  assert(/aria-selected/.test(src), 'TabBar marks the active tab with aria-selected');
}

// -------- 9. WorkflowPanel routes setup → SetupMode when wired --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/WorkflowPanel.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(src), 'WorkflowPanel.tsx carries T1-207 marker');
  assert(
    /import \{ SetupMode/.test(src),
    'WorkflowPanel imports SetupMode',
  );
  assert(/setupModeProps: SetupModeProps \| null/.test(src),
    'WorkflowPanelProps adds setupModeProps');
  // The setup case routes to SetupMode when wired AND falls back
  // to ModeStub when not.
  assert(
    /case 'setup'[\s\S]{0,500}React\.createElement\(SetupMode/.test(src),
    'setup mode router calls SetupMode when wired',
  );
  assert(
    /props\.setupModeProps !== null/.test(src),
    'setup mode router checks setupModeProps !== null',
  );
}

// -------- 9b. T1-211: Frame buttons in the Move tab --------
//
// User-reported usability gap after the phase rollout: Frame is
// needed before every job and the new panel had no way to do it
// without flipping the flag off. T1-211 wires Frame + Frame-Dot
// buttons through to executionCoordinator.frameSafe / frameDot.
{
  const moveSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/setup/MoveTab.tsx'),
    'utf-8',
  );
  assert(/T1-211/.test(moveSrc), 'MoveTab.tsx carries T1-211 marker');
  assert(/workflow-move-frame-safe/.test(moveSrc), 'MoveTab renders Frame button with testid');
  assert(/workflow-move-frame-dot/.test(moveSrc), 'MoveTab renders Frame+Dot button with testid');
  // Buttons are gated on canFrame AND non-null callback.
  assert(
    /disabled:\s*!props\.canFrame \|\| props\.onFrameSafe === null/.test(moveSrc),
    'Frame button disables when canFrame is false or callback is null',
  );

  const setupSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/SetupMode.tsx'),
    'utf-8',
  );
  assert(/T1-211/.test(setupSrc), 'SetupMode.tsx carries T1-211 marker');
  assert(/canFrame: props\.canFrame/.test(setupSrc), 'SetupMode threads canFrame to MoveTab');
  assert(/onFrameSafe: props\.onFrameSafe/.test(setupSrc), 'SetupMode threads onFrameSafe to MoveTab');
  assert(/onFrameDot: props\.onFrameDot/.test(setupSrc), 'SetupMode threads onFrameDot to MoveTab');

  const adapterSrc = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanel.tsx'),
    'utf-8',
  );
  assert(/T1-211/.test(adapterSrc), 'ConnectionPanel.tsx carries T1-211 marker');
  assert(
    /executionCoordinator[\s\S]{0,400}\.frameSafe\(/.test(adapterSrc),
    'adapter wires onFrameSafe to executionCoordinator.frameSafe',
  );
  assert(
    /executionCoordinator[\s\S]{0,400}\.frameDot\(/.test(adapterSrc),
    'adapter wires onFrameDot to executionCoordinator.frameDot',
  );
  // Frame-dot acknowledgement gate (same localStorage key as legacy).
  assert(
    /laserforge_frame_dot_acknowledged_v2/.test(adapterSrc),
    'adapter shares the frame-dot acknowledgement localStorage key with the legacy panel',
  );
  // canFrame requires compiled bounds.
  assert(
    /sceneBounds[\s\S]{0,200}canvasPlanBounds/.test(adapterSrc),
    'adapter resolves sceneBounds from compileResult.canvasPlanBounds',
  );
}

// -------- 10. ConnectionPanel adapter wires setupModeProps --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanel.tsx'),
    'utf-8',
  );
  assert(/T1-207/.test(src), 'ConnectionPanel.tsx carries T1-207 marker');
  assert(
    /const setupModeProps = \{/.test(src),
    'adapter builds setupModeProps object',
  );
  // Jog wiring with a feed default.
  assert(
    /JOG_DEFAULT_FEED_MM_PER_MIN/.test(src),
    'adapter wires jog with a feed default',
  );
  assert(
    /executionCoordinator\.jog\(axis, distance, JOG_DEFAULT_FEED_MM_PER_MIN\)/.test(src),
    'adapter wires onJog → executionCoordinator.jog(axis, distance, feed)',
  );
  // sendUserCommand carve-out for warn/dangerous.
  assert(
    /classifyUserCommand/.test(src),
    'adapter classifies user commands before sending',
  );
  assert(
    /classification\.severity === 'dangerous' \|\| classification\.severity === 'warn'/.test(src),
    'adapter blocks warn/dangerous commands in Phase 3 (legacy panel handles approvals)',
  );
  // canHome is gated.
  assert(
    /canHome:[\s\S]{0,80}machineStatus === 'idle'/.test(src),
    'canHome requires idle machineStatus',
  );
  // setupModeProps threaded into the WorkflowPanel call.
  assert(
    /WorkflowPanel,[\s\S]{0,1500}setupModeProps,/.test(src),
    'adapter passes setupModeProps to WorkflowPanel',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
