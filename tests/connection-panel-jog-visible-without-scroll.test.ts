import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const moveControls = readFileSync(resolve(root, 'src/ui/components/MoveControls.tsx'), 'utf-8');
const consolePanel = readFileSync(resolve(root, 'src/ui/components/ConsolePanel.tsx'), 'utf-8');
const workflow = readFileSync(resolve(root, 'src/ui/components/connection/Workflow.tsx'), 'utf-8');
const detailsPanelPath = resolve(root, 'src/ui/components/connection/ConnectionDetailsPanel.tsx');
const detailsPanel = existsSync(detailsPanelPath) ? readFileSync(detailsPanelPath, 'utf-8') : '';
const controls = readFileSync(resolve(root, 'src/ui/components/connection/Controls.tsx'), 'utf-8');

const renderBlock = panel.slice(panel.indexOf('React.createElement(ConnectionControls'), panel.indexOf('React.createElement(JobControls'));
const scrollIndex = renderBlock.indexOf("overflowY: 'auto' as const");
const controlsMatch = /isConnected && detailsPanel == null && !isRunning && !displayPaused && controlsSection/.exec(renderBlock);
const jobPositionMatch = /isConnected && detailsPanel == null && !isRunning && !displayPaused && jobPositionSection/.exec(renderBlock);
const detailLaunchersIndex = renderBlock.indexOf('detailLaunchersSection');
const controlsIndex = controlsMatch?.index ?? -1;
const jobPositionIndex = jobPositionMatch?.index ?? -1;
const moveControlsCall = renderBlock.slice(renderBlock.indexOf('React.createElement(MoveControls'), renderBlock.indexOf('React.createElement(ConsolePanel'));
const detailsPanelCall = renderBlock.slice(renderBlock.indexOf('React.createElement(ConnectionDetailsPanel'), renderBlock.indexOf('React.createElement(MoveControls'));

assert(scrollIndex >= 0, 'ConnectionPanelMain still has a scrollable sidebar content region');
assert(controlsIndex >= 0, 'ConnectionPanelMain renders controlsSection in the fixed area');
assert(controlsIndex < scrollIndex, 'jog/test-fire controls render before the scrollable content');
assert(jobPositionIndex >= 0, 'ConnectionPanelMain renders jobPositionSection in the fixed area');
assert(controlsIndex < jobPositionIndex, 'Job Position renders directly after Move Laser controls');
assert(jobPositionIndex < scrollIndex, 'Job Position and Set Origin render before the scrollable content');
assert(detailLaunchersIndex > jobPositionIndex && detailLaunchersIndex < scrollIndex, 'Job details launchers render outside the collapsing scroll area');
assert(!/controlsSection,/.test(moveControlsCall), 'MoveControls call no longer receives controlsSection');
assert(!/jobPositionSection,/.test(moveControlsCall), 'MoveControls call never receives the fixed Job Position section');
assert(!/controlsSection/.test(moveControls), 'MoveControls no longer owns the jog/test-fire controls');
assert(!/Job Position/.test(moveControls), 'MoveControls no longer owns the Job Position UI');
assert(panel.indexOf('EMERGENCY STOP') > scrollIndex, 'emergency stop remains outside the scrollable content');
assert(/data-testid': 'connection-emergency-stop'/.test(panel), 'emergency stop has a stable test id');
assert(/Move Laser/.test(panel), 'fixed movement zone is explicitly labeled Move Laser');
assert(/export function JobPosition/.test(workflow), 'Workflow.tsx exposes a fixed JobPosition section');
assert(/startMode === 'savedOrigin'[\s\S]*Set Origin/.test(workflow), 'fixed JobPosition exposes Set Origin when saved zero point is selected');
assert(/Run Job/.test(controls), 'fixed job footer is explicitly labeled Run Job');
assert(/JobDetailsLaunchers/.test(panel), 'main drawer defines compact job detail launchers');
assert(detailLaunchersIndex >= 0, 'main drawer renders compact job detail launchers');
assert(/ConnectionDetailsPanel/.test(renderBlock), 'main drawer owns a secondary details panel');
assert(/workflowSection/.test(detailsPanelCall), 'details panel receives Workflow content');
assert(/issuesSection/.test(detailsPanelCall), 'details panel receives Issues content');
assert(/advancedSection/.test(detailsPanelCall), 'details panel receives Advanced content');
assert(!/workflowStepsSection,/.test(moveControlsCall), 'MoveControls call no longer receives full Workflow content');
assert(!/issuesSection,/.test(moveControlsCall), 'MoveControls call no longer receives full Issues content');
assert(!/workflowStepsSection/.test(moveControls), 'MoveControls no longer owns full Workflow content');
assert(!/issuesSection/.test(moveControls), 'MoveControls no longer owns full Issues content');
assert(!/Advanced machine details/.test(consolePanel), 'ConsolePanel no longer renders the advanced details launcher inline');
assert(!/aria-expanded/.test(consolePanel), 'ConsolePanel no longer owns collapsed advanced disclosure state');
assert(/data-testid': 'connection-details-launchers'/.test(detailsPanel), 'detail launcher row has a stable test id');
assert(/data-testid': 'connection-details-panel'/.test(detailsPanel), 'secondary details panel has a stable test id');
assert(/data-testid': 'connection-details-section'/.test(detailsPanel), 'active details body has a stable test id');
