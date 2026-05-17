/**
 * T1-208 (Phase 4): regression test for the live-job modes (ready,
 * running, paused) + the adapter wiring for pause / resume / stop.
 *
 * Same source-pin approach as Phase 2 + Phase 3: the mode bodies
 * reuse the existing `Progress` component which isn't render-
 * testable in tsx without JSDOM. Pinning instead:
 *
 *   - Each mode file exists, declares T1-208 marker, imports the
 *     right existing component (Progress for Running / Paused;
 *     ReadyMode is custom-built).
 *   - WorkflowPanel routes the three live-job modes to their real
 *     mode components when `liveJobProps` is supplied AND falls
 *     back to ModeStub when null.
 *   - The adapter builds `liveJobProps` with the expected
 *     wirings (jobProgress from machineUi, jobName from
 *     scene.metadata, pause/resume/stop wired to machineService).
 *
 * Run: npx tsx tests/workflow-panel-phase4-live-job.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\n=== T1-208 WorkflowPanel Phase 4 live-job modes ===\n');

// -------- 1. ReadyMode --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/ReadyMode.tsx'),
    'utf-8',
  );
  assert(/T1-208/.test(src), 'ReadyMode.tsx carries T1-208 marker');
  assert(
    /['"]?Ready to run['"]?/.test(src),
    'ReadyMode shows "Ready to run" status banner',
  );
  assert(/jobName/.test(src), 'ReadyMode surfaces jobName');
  assert(/lineCount/.test(src), 'ReadyMode surfaces lineCount');
  assert(/estimatedTime/.test(src), 'ReadyMode surfaces estimatedTime');
  // ReadyMode body has no Start button — that's in the footer.
  assert(
    !/onClick:[\s\S]{0,40}Start/.test(src),
    'ReadyMode body has no Start onClick — footer owns the primary action',
  );
}

// -------- 2. RunningMode --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/RunningMode.tsx'),
    'utf-8',
  );
  assert(/T1-208/.test(src), 'RunningMode.tsx carries T1-208 marker');
  assert(
    /import \{ Progress[^}]*\} from '\.\.\/\.\.\/connection\/Progress'/.test(src),
    'RunningMode imports the existing Progress component',
  );
  assert(/React\.createElement\(Progress/.test(src), 'RunningMode renders Progress');
  assert(/displayPaused:\s*false/.test(src), 'RunningMode passes displayPaused=false');
}

// -------- 3. PausedMode --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/PausedMode.tsx'),
    'utf-8',
  );
  assert(/T1-208/.test(src), 'PausedMode.tsx carries T1-208 marker');
  assert(
    /import \{ Progress[^}]*\} from '\.\.\/\.\.\/connection\/Progress'/.test(src),
    'PausedMode imports the existing Progress component',
  );
  assert(/displayPaused:\s*true/.test(src), 'PausedMode passes displayPaused=true');
}

// -------- 4. WorkflowPanel routes the three modes --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/workflow/WorkflowPanel.tsx'),
    'utf-8',
  );
  assert(/T1-208/.test(src), 'WorkflowPanel.tsx carries T1-208 marker');
  assert(/import \{ ReadyMode/.test(src), 'WorkflowPanel imports ReadyMode');
  assert(/import \{ RunningMode/.test(src), 'WorkflowPanel imports RunningMode');
  assert(/import \{ PausedMode/.test(src), 'WorkflowPanel imports PausedMode');
  // liveJobProps prop with bundled shape.
  assert(
    /liveJobProps: \{[\s\S]{0,400}ready: ReadyModeProps[\s\S]{0,400}running: RunningModeProps[\s\S]{0,400}paused: PausedModeProps/.test(src),
    'WorkflowPanelProps adds liveJobProps with bundled ready / running / paused',
  );
  // Mode-content router calls each real mode + falls back to ModeStub.
  assert(
    /case 'ready'[\s\S]{0,400}React\.createElement\(ReadyMode/.test(src),
    'ready mode router calls ReadyMode when wired',
  );
  assert(
    /case 'running'[\s\S]{0,400}React\.createElement\(RunningMode/.test(src),
    'running mode router calls RunningMode when wired',
  );
  assert(
    /case 'paused'[\s\S]{0,400}React\.createElement\(PausedMode/.test(src),
    'paused mode router calls PausedMode when wired',
  );
  // ModeStub fallback for null liveJobProps.
  assert(
    /props\.liveJobProps !== null/.test(src),
    'router checks liveJobProps !== null before calling real modes',
  );
}

// -------- 5. ConnectionPanel adapter wires liveJobProps --------
{
  const src = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanel.tsx'),
    'utf-8',
  );
  assert(/T1-208/.test(src), 'ConnectionPanel.tsx carries T1-208 marker');
  assert(
    /const liveJobProps = \{/.test(src),
    'adapter builds liveJobProps object',
  );
  // jobName comes from the scene metadata.
  assert(
    /jobName = props\.scene\.metadata\?\.name/.test(src),
    'adapter resolves jobName from scene.metadata',
  );
  // Pause / Resume / Stop are wired (Start stays null).
  assert(
    /onPause[\s\S]{0,500}machineService\.pause\(\)/.test(src),
    'adapter wires onPause to machineService.pause',
  );
  assert(
    /onResume[\s\S]{0,500}machineService\.resume\(\)/.test(src),
    'adapter wires onResume to machineService.resume',
  );
  assert(
    /onStop[\s\S]{0,100}stopAndEnsureLaserOff\(\)/.test(src),
    'adapter wires onStop to machineService.stopAndEnsureLaserOff',
  );
  // T1-209 (Phase 5a) wired Start Job. The adapter no longer hard-
  // codes onStartJob: null; it computes a callable when the start
  // preconditions are met. Pin the new wiring: executionCoordinator.
  // startValidatedJob is called and saved-origin mode falls back to
  // the legacy panel.
  assert(
    /executionCoordinator[\s\S]{0,200}\.startValidatedJob\(\{/.test(src),
    'adapter wires onStartJob to executionCoordinator.startValidatedJob',
  );
  assert(
    /allowUnverifiedWcsStart:\s*activeProfile\?\.allowUnverifiedWcsStart === true/.test(src),
    'adapter forwards profile WCS compatibility into startValidatedJob',
  );
  assert(
    /startMode !== 'savedOrigin'/.test(src),
    "adapter blocks savedOrigin in the new panel (Phase 5b lifts the G54 drift check)",
  );
  // liveJobProps threaded into the WorkflowPanel call.
  assert(
    /WorkflowPanel,[\s\S]{0,2000}liveJobProps,/.test(src),
    'adapter passes liveJobProps to WorkflowPanel',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
