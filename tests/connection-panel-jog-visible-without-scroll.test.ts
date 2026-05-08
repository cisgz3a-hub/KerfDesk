import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const moveControls = readFileSync(resolve(root, 'src/ui/components/MoveControls.tsx'), 'utf-8');
const consolePanel = readFileSync(resolve(root, 'src/ui/components/ConsolePanel.tsx'), 'utf-8');
const workflow = readFileSync(resolve(root, 'src/ui/components/connection/Workflow.tsx'), 'utf-8');

const renderBlock = panel.slice(panel.indexOf('React.createElement(ConnectionControls'), panel.indexOf('React.createElement(JobControls'));
const scrollIndex = renderBlock.indexOf("overflowY: 'auto' as const");
const controlsIndex = renderBlock.indexOf("isConnected && !isRunning && !displayPaused && controlsSection");
const jobPositionIndex = renderBlock.indexOf("isConnected && !isRunning && !displayPaused && jobPositionSection");
const moveControlsCall = renderBlock.slice(renderBlock.indexOf('React.createElement(MoveControls'), renderBlock.indexOf('React.createElement(ConsolePanel'));

assert(scrollIndex >= 0, 'ConnectionPanelMain still has a scrollable sidebar content region');
assert(controlsIndex >= 0, 'ConnectionPanelMain renders controlsSection in the fixed area');
assert(controlsIndex < scrollIndex, 'jog/test-fire controls render before the scrollable content');
assert(jobPositionIndex >= 0, 'ConnectionPanelMain renders jobPositionSection in the fixed area');
assert(controlsIndex < jobPositionIndex, 'Job Position renders directly after Move Laser controls');
assert(jobPositionIndex < scrollIndex, 'Job Position and Set Origin render before the scrollable content');
assert(!/controlsSection,/.test(moveControlsCall), 'MoveControls call no longer receives controlsSection');
assert(!/jobPositionSection,/.test(moveControlsCall), 'MoveControls call never receives the fixed Job Position section');
assert(!/controlsSection/.test(moveControls), 'MoveControls no longer owns the jog/test-fire controls');
assert(!/Job Position/.test(moveControls), 'MoveControls no longer owns the Job Position UI');
assert(panel.indexOf('EMERGENCY STOP') > scrollIndex, 'emergency stop remains outside the scrollable content');
assert(/Move Laser/.test(panel), 'fixed movement zone is explicitly labeled Move Laser');
assert(/export function JobPosition/.test(workflow), 'Workflow.tsx exposes a fixed JobPosition section');
assert(/startMode === 'savedOrigin'[\s\S]*Set Origin/.test(workflow), 'fixed JobPosition exposes Set Origin when saved zero point is selected');
assert(/Run Job/.test(readFileSync(resolve(root, 'src/ui/components/connection/Controls.tsx'), 'utf-8')), 'fixed job footer is explicitly labeled Run Job');
assert(/Advanced machine details/.test(consolePanel), 'ConsolePanel exposes advanced machine details disclosure');
assert(/useState\(false\)/.test(consolePanel), 'advanced machine details are collapsed by default');
assert(/aria-expanded/.test(consolePanel), 'advanced machine details disclosure exposes aria-expanded');
