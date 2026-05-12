import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StartReadinessGate } from '../src/ui/components/connection/StartReadinessPanel';

const readinessSource = readFileSync(
  resolve(process.cwd(), 'src/ui/components/connection/buildStartReadiness.ts'),
  'utf8'
);
const panelSource = readFileSync(
  resolve(process.cwd(), 'src/ui/components/ConnectionPanelMain.tsx'),
  'utf8'
);

function requiredIndex(sourceName: string, source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `Expected ${sourceName} to include ${needle}`);
  return index;
}

const frameControlsGate: StartReadinessGate = {
  id: 'frameControls',
  label: 'Frame control available',
  status: 'fail',
  failHeadline: 'Frame control is not available',
  failAction: 'Resolve the machine state, then frame again',
};

const framingGate: StartReadinessGate = {
  id: 'framing',
  label: 'Job framed',
  status: 'fail',
  failHeadline: 'Frame not done since last design change',
  failAction: 'Click Frame',
};

const blockingGate = [frameControlsGate, framingGate].find(gate => gate.status === 'fail');
assert.equal(
  blockingGate?.id,
  'frameControls',
  'Frame-control failures must be the first visible Start blocker'
);

const frameControlsIndex = requiredIndex(
  'buildStartReadiness.ts',
  readinessSource,
  "id: 'frameControls'"
);
const framingIndex = requiredIndex('buildStartReadiness.ts', readinessSource, "id: 'framing'");
assert(
  frameControlsIndex < framingIndex,
  'buildStartReadiness must check frame-control availability before the framing-required gate'
);

const framingBlock = readinessSource.slice(framingIndex, framingIndex + 600);
assert(
  /canFrame[\s\S]*'fail'[\s\S]*'pending'/.test(framingBlock),
  'When Frame itself is disabled, the framing-required gate should be pending, not the first failure'
);

assert(
  panelSource.includes('const activeOperation = machineService.getActiveOperation();'),
  'ConnectionPanelMain should reuse activeOperation so the frame-control blocker can name stuck operations'
);

assert(
  panelSource.includes('const recoveryPending = getUnsafePriorState() != null;'),
  'ConnectionPanelMain should reuse recoveryPending so the frame-control blocker can name recovery holds'
);
