/**
 * Regression: a "From laser head" frame is valid only for the head
 * position it framed from.
 *
 * User report: run a test burn, machine parks/homes afterward, then
 * starting the unchanged drawing again burns a few centimetres away.
 * In current/head mode the emitted G-code is relative (G91), so the
 * physical head position is the job anchor. If the head moves after
 * framing, the previous frame no longer proves where the next burn
 * will land.
 *
 * Run: npx tsx tests/current-mode-frame-anchor.test.ts
 */
import {
  CURRENT_FRAME_ANCHOR_TOLERANCE_MM,
  captureCurrentFrameAnchor,
  currentModeFrameAnchorAllowsStart,
} from '../src/app/CurrentFrameAnchor';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
{
  const anchor = captureCurrentFrameAnchor('current', { x: 42, y: 17 });
  assert(anchor?.x === 42 && anchor.y === 17, 'current mode captures the framed head position');
}

{
  const anchor = captureCurrentFrameAnchor('absolute', { x: 42, y: 17 });
  assert(anchor === null, 'absolute mode does not need a head-position anchor');
}

{
  const anchor = { x: 42, y: 17 };
  assert(
    currentModeFrameAnchorAllowsStart({
      startMode: 'current',
      frameAnchor: anchor,
      machinePosition: { x: 42.05, y: 17.04 },
    }),
    'current mode allows tiny status-report noise at the framed anchor',
  );
}

{
  const anchor = { x: 42, y: 17 };
  assert(
    !currentModeFrameAnchorAllowsStart({
      startMode: 'current',
      frameAnchor: anchor,
      machinePosition: { x: 0, y: 0 },
    }),
    'current mode blocks when homing/parking moved the head away from the framed anchor',
  );
}

{
  assert(
    currentModeFrameAnchorAllowsStart({
      startMode: 'savedOrigin',
      frameAnchor: null,
      machinePosition: { x: 0, y: 0 },
    }),
    'saved-origin mode is handled by G54 verification, not the current-mode anchor',
  );
}

{
  assert(
    CURRENT_FRAME_ANCHOR_TOLERANCE_MM > 0 && CURRENT_FRAME_ANCHOR_TOLERANCE_MM < 1,
    'anchor tolerance is sub-millimetre: absorbs report noise, catches centimetre drift',
  );
}

{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const panelSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(
    panelSrc.includes('currentFrameAnchorRef'),
    'ConnectionPanelMain stores a current-mode frame anchor',
  );
  assert(
    panelSrc.includes('currentModeFrameAnchorValid'),
    'ConnectionPanelMain gates Start on current-mode anchor validity',
  );
}

console.log('current-mode frame anchor regression: ok');
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
