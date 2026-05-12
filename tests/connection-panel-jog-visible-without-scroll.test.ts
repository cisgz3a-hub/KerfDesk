/**
 * T1-214: superseded test — original intent was "jog/test-fire
 * controls render before the scrollable content (always visible
 * without scroll)." User feedback contradicted that design:
 * having jog + jobPosition + detailLaunchers all in the fixed
 * area meant on smaller windows the E-Stop button got pushed
 * off-screen. The new design pins the high-priority safety
 * surfaces (status + recovery banners at top; JobControls +
 * E-Stop at bottom) and scrolls the prep content (profile + jog
 * + jobPosition + detailLaunchers + readyToRun + MoveControls).
 *
 * This file is repurposed to enforce the NEW design constraints
 * so a future refactor can't accidentally regress E-Stop
 * visibility:
 *
 *   - The panel has a single scrollable middle area.
 *   - JobControls + E-Stop sit AFTER the scrollable area (pinned
 *     at the bottom).
 *   - Recovery cards (alarm / frame-failed / job-failed /
 *     safety) sit BEFORE the scrollable area (pinned at the
 *     top — always visible regardless of how much prep content
 *     is below).
 *   - The bottom JobControls + E-Stop are wrapped in a
 *     flexShrink:0 div so they form an indivisible footer.
 *   - The E-Stop button still has its stable test id for
 *     regression / hardware-verification tooling.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');

const renderBlock = panel.slice(
  panel.indexOf('React.createElement(ConnectionControls'),
  panel.indexOf('EMERGENCY STOP') + 200,
);

const scrollIndex = renderBlock.indexOf("overflowY: 'auto' as const");
assert(scrollIndex >= 0, 'ConnectionPanelMain still has a scrollable sidebar content region');

// T1-214 source pins.
assert(/T1-214/.test(panel), 'ConnectionPanelMain carries T1-214 marker');

// Recovery cards pinned at the TOP (before the scrollable area).
const recoveryCardIndex = renderBlock.indexOf('connectionRecoveryCard');
assert(recoveryCardIndex >= 0, 'ConnectionPanelMain still renders connectionRecoveryCard');
assert(recoveryCardIndex < scrollIndex,
  'recovery cards render BEFORE the scrollable area (pinned at top)');

// Prep sections moved INTO the scrollable middle.
const controlsSectionIndex = renderBlock.indexOf('controlsSection');
assert(controlsSectionIndex >= 0, 'ConnectionPanelMain still renders controlsSection');
assert(controlsSectionIndex > scrollIndex,
  'controlsSection (jog / test-fire) renders INSIDE the scrollable area (T1-214: was outside, pushed E-Stop)');

const jobPositionIndex = renderBlock.indexOf('jobPositionSection');
assert(jobPositionIndex >= 0, 'ConnectionPanelMain still renders jobPositionSection');
assert(jobPositionIndex > scrollIndex,
  'jobPositionSection renders INSIDE the scrollable area');

const detailLaunchersIndex = renderBlock.indexOf('detailLaunchersSection');
assert(detailLaunchersIndex >= 0, 'ConnectionPanelMain still renders detailLaunchersSection');
assert(detailLaunchersIndex > scrollIndex,
  'detailLaunchersSection renders INSIDE the scrollable area');

// E-Stop AFTER the scrollable, in a flexShrink:0 wrapper.
const eStopIndex = renderBlock.indexOf('EMERGENCY STOP');
assert(eStopIndex > scrollIndex, 'emergency stop renders AFTER the scrollable area (pinned at bottom)');

// Bottom-bar wrapper around JobControls + E-Stop.
const bottomBarComment = panel.indexOf('// T1-214: wrap JobControls + E-Stop in a single bottom bar');
assert(bottomBarComment >= 0, 'JobControls + E-Stop wrapped in a T1-214 bottom bar');

// Stable selectors preserved.
assert(/data-testid': 'connection-emergency-stop'/.test(panel),
  'emergency stop has a stable test id');
