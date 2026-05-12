/**
 * T1-204: source-pin regression for the Phase-1 WorkflowPanel
 * scaffold. The component is too React-heavy to render in this
 * test-runner (tsx, no JSDOM) so source pins guarantee the shape
 * stays right between phases — specifically that:
 *
 *   - All seven panel modes have a `pickActions` mapping.
 *   - Each mode points at a real `modeImplementationPhase` number
 *     so the stubs tell the user which phase will replace them.
 *   - The three zones (TopBar, mode content, PrimaryActionFooter)
 *     are present in WorkflowPanel.tsx.
 *   - ConnectionPanel.tsx routes through the feature flag.
 *   - The feature flag's default is wired (no surprise enabled-by-
 *     default ship).
 *
 * Run: npx tsx tests/workflow-panel-scaffold.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickActions, modeImplementationPhase } from '../src/ui/components/workflow/WorkflowPanel';
import type { PanelMode } from '../src/ui/components/workflow/derivePanelMode';

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
const ALL_MODES: ReadonlyArray<PanelMode> = [
  'disconnected', 'connecting', 'recovery',
  'setup', 'ready', 'running', 'paused',
];

console.log('\n=== T1-204 WorkflowPanel scaffold ===\n');

// -------- 1. pickActions covers every mode with a defined primary --------
{
  const stubProps = {
    machineState: null,
    machineStatus: null,
    isConnected: false,
    isConnecting: false,
    recoveryState: { status: 'none' as const },
    canStartJob: false,
    onEmergencyStop: null,
    onConnectUsb: null,
    onConnectSimulator: null,
    onCancelConnect: null,
    onStartJob: null,
    onPause: null,
    onResume: null,
    onStop: null,
    webSerialSupported: false,
    alarmCode: null,
    onRecoveryAction: null,
    setupModeProps: null,
    liveJobProps: null,
    pauseRequested: false,
    onFrameSafe: null,
  };
  for (const mode of ALL_MODES) {
    const actions = pickActions(mode, stubProps);
    assert(typeof actions.primary.label === 'string' && actions.primary.label.length > 0,
      `'${mode}' produces a non-empty primary label`);
    assert(
      ['primary', 'success', 'danger', 'disabled'].includes(actions.primary.variant),
      `'${mode}' primary variant is one of the four enum values`,
    );
    assert(Array.isArray(actions.secondaries), `'${mode}' returns a secondaries array`);
  }
}

// -------- 2. Mode-specific primaries match the design --------
{
  const stubProps = {
    machineState: null,
    machineStatus: null,
    isConnected: false,
    isConnecting: false,
    recoveryState: { status: 'none' as const },
    canStartJob: false,
    onEmergencyStop: null,
    onConnectUsb: null,
    onConnectSimulator: null,
    onCancelConnect: null,
    onStartJob: null,
    onPause: null,
    onResume: null,
    onStop: null,
    webSerialSupported: false,
    alarmCode: null,
    onRecoveryAction: null,
    setupModeProps: null,
    liveJobProps: null,
    pauseRequested: false,
    onFrameSafe: null,
  };
  assert(/Connect/.test(pickActions('disconnected', stubProps).primary.label),
    "'disconnected' primary mentions Connect");
  assert(/Connecting/.test(pickActions('connecting', stubProps).primary.label),
    "'connecting' primary mentions Connecting");
  assert(pickActions('connecting', stubProps).primary.variant === 'disabled',
    "'connecting' primary is disabled (action is in the Cancel secondary)");
  assert(pickActions('recovery', stubProps).primary.variant === 'disabled',
    "'recovery' primary is disabled — hard lock per the design");
  assert(pickActions('recovery', stubProps).secondaries.length === 0,
    "'recovery' has no secondary actions — hard lock");
  assert(/Start Job/.test(pickActions('ready', stubProps).primary.label),
    "'ready' primary is Start Job");
  assert(pickActions('ready', stubProps).primary.variant === 'success',
    "'ready' primary is the success variant (green)");
  // T1-212: Frame sits beside Start Job as a secondary so both
  // buttons are visible together (matches the legacy panel).
  assert(
    pickActions('ready', stubProps).secondaries.some(s => /Frame/.test(s.label)),
    "'ready' has a Frame secondary (T1-212 — beside Start Job)",
  );
  assert(
    pickActions('setup', stubProps).secondaries.some(s => /Frame/.test(s.label)),
    "'setup' has a Frame secondary (T1-212 — available before ready)",
  );
  assert(/Pause/.test(pickActions('running', stubProps).primary.label),
    "'running' primary is Pause");
  assert(
    pickActions('running', stubProps).secondaries.some(s => /Stop/.test(s.label)),
    "'running' has a Stop secondary",
  );
  assert(/Resume/.test(pickActions('paused', stubProps).primary.label),
    "'paused' primary is Resume");
  assert(
    pickActions('paused', stubProps).secondaries.some(s => /Stop/.test(s.label)),
    "'paused' has a Stop secondary",
  );
}

// -------- 3. modeImplementationPhase points at a real phase --------
{
  for (const mode of ALL_MODES) {
    const phase = modeImplementationPhase(mode);
    assert(phase >= 2 && phase <= 4, `'${mode}' implementation phase is 2..4 (got ${phase})`);
  }
  // Verify the design's phasing — simplest modes first.
  assert(modeImplementationPhase('disconnected') === 2, 'disconnected is Phase 2');
  assert(modeImplementationPhase('connecting') === 2, 'connecting is Phase 2');
  assert(modeImplementationPhase('recovery') === 2, 'recovery is Phase 2');
  assert(modeImplementationPhase('setup') === 3, 'setup (with three tabs) is Phase 3');
  assert(modeImplementationPhase('ready') === 4, 'ready is Phase 4');
  assert(modeImplementationPhase('running') === 4, 'running is Phase 4');
  assert(modeImplementationPhase('paused') === 4, 'paused is Phase 4');
}

// -------- 4. Source pins on WorkflowPanel.tsx --------
{
  const src = readFileSync(resolve(here, '../src/ui/components/workflow/WorkflowPanel.tsx'), 'utf-8');
  assert(/T1-204/.test(src), 'WorkflowPanel.tsx carries T1-204 marker');
  assert(/import.*TopBar.*from '\.\/zones\/TopBar'/.test(src),
    'imports TopBar from zones/');
  assert(/PrimaryActionFooter[\s\S]{0,400}from '\.\/zones\/PrimaryActionFooter'/.test(src),
    'imports PrimaryActionFooter from zones/');
  assert(/import.*ModeStub.*from '\.\/modes\/ModeStub'/.test(src),
    'imports ModeStub from modes/');
  // Three zones must all be rendered.
  assert(/React\.createElement\(TopBar/.test(src), 'renders TopBar zone');
  assert(/React\.createElement\(PrimaryActionFooter/.test(src), 'renders PrimaryActionFooter zone');
  assert(/'workflow-mode-content'/.test(src), 'renders mode-content zone with testid');
  // ModeStub used for every mode in Phase 1.
  assert(/React\.createElement\(ModeStub/.test(src), 'renders ModeStub in mode content');
}

// -------- 5. Source pins on ConnectionPanel.tsx routing --------
{
  const src = readFileSync(resolve(here, '../src/ui/components/ConnectionPanel.tsx'), 'utf-8');
  assert(/T1-204/.test(src), 'ConnectionPanel.tsx carries T1-204 marker');
  assert(/import \{ WorkflowPanel \} from '\.\/workflow\/WorkflowPanel'/.test(src),
    'imports WorkflowPanel');
  assert(/import \{[^}]*getUiFeatureFlag[^}]*\}/.test(src),
    'imports getUiFeatureFlag from features/uiFeatureFlags');
  assert(/getUiFeatureFlag\('workflowPanelV2'\)/.test(src),
    'reads the workflowPanelV2 flag');
  // Falcon-WiFi precedence still wins over the new panel.
  const falconIdx = src.indexOf("isFalcon && activeProfile");
  const newPanelIdx = src.indexOf('workflowPanelV2 = ');
  assert(falconIdx > 0 && newPanelIdx > 0, 'both Falcon and new-panel branches present');
}

// -------- 6. Source pins on feature flag default --------
{
  const src = readFileSync(resolve(here, '../src/ui/features/uiFeatureFlags.ts'), 'utf-8');
  assert(/T1-204/.test(src), 'uiFeatureFlags.ts carries T1-204 marker');
  assert(/workflowPanelV2:\s*false/.test(src),
    'workflowPanelV2 default is false (no surprise enabled-by-default ship)');
  assert(/STORAGE_KEY_PREFIX = 'laserforge\.feature\.'/.test(src),
    'storage prefix is laserforge.feature.');
}

// -------- 7. Design doc exists --------
{
  const docSrc = readFileSync(resolve(here, '../docs/CONNECTION-PANEL-REDESIGN.md'), 'utf-8');
  assert(/Connection-panel redesign/.test(docSrc), 'design doc exists');
  assert(/Phase 1/.test(docSrc) && /Phase 5/.test(docSrc),
    'design doc names all five phases');
  assert(/WorkflowPanel/.test(docSrc), 'design doc names the new component');
  assert(/workflowPanelV2/.test(docSrc), 'design doc names the feature flag');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
