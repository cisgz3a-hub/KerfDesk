import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const moveControls = readFileSync(resolve(root, 'src/ui/components/MoveControls.tsx'), 'utf-8');

const renderBlock = panel.slice(panel.indexOf('React.createElement(ConnectionControls'), panel.indexOf('React.createElement(JobControls'));
const scrollIndex = renderBlock.indexOf("overflowY: 'auto' as const");
const controlsIndex = renderBlock.indexOf("isConnected && !isRunning && !displayPaused && controlsSection");
const moveControlsCall = renderBlock.slice(renderBlock.indexOf('React.createElement(MoveControls'), renderBlock.indexOf('React.createElement(ConsolePanel'));

assert(scrollIndex >= 0, 'ConnectionPanelMain still has a scrollable sidebar content region');
assert(controlsIndex >= 0, 'ConnectionPanelMain renders controlsSection in the fixed area');
assert(controlsIndex < scrollIndex, 'jog/test-fire controls render before the scrollable content');
assert(!/controlsSection,/.test(moveControlsCall), 'MoveControls call no longer receives controlsSection');
assert(!/controlsSection/.test(moveControls), 'MoveControls no longer owns the jog/test-fire controls');
