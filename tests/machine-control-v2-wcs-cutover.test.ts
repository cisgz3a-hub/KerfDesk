import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dispatchResetWcsToBaseline,
  createResetWcsToBaselineIntent,
  type MachineControlV2Dispatch,
} from '../src/machine-control-v2/ControllerPanelAdapter';

const intent = createResetWcsToBaselineIntent();
if (JSON.stringify(intent) !== JSON.stringify({ kind: 'resetWcsToBaseline', axes: ['X', 'Y'] })) {
  throw new Error(`wrong reset WCS intent: ${JSON.stringify(intent)}`);
}

const dispatched: unknown[] = [];
const dispatch: MachineControlV2Dispatch = (next) => {
  dispatched.push(next);
};
dispatchResetWcsToBaseline(dispatch);

if (JSON.stringify(dispatched) !== JSON.stringify([{ kind: 'resetWcsToBaseline', axes: ['X', 'Y'] }])) {
  throw new Error(`reset WCS did not dispatch typed v2 intent: ${JSON.stringify(dispatched)}`);
}

const panelSource = readFileSync(
  resolve('src/ui/components/ConnectionPanelMain.tsx'),
  'utf8',
);

if (!panelSource.includes('dispatchResetWcsToBaseline(dispatchMachineControlV2Intent)')) {
  throw new Error('ConnectionPanelMain reset WCS path does not dispatch through the v2 intent gate');
}

if (/onResetWcsToBaseline:\s*\(\)\s*=>\s*\{[\s\S]{0,120}applyWcsNormalization/.test(panelSource)) {
  throw new Error('ConnectionPanelMain still wires Reset WCS directly to applyWcsNormalization');
}

const dispatchBlockMatch = panelSource.match(
  /const dispatchMachineControlV2Intent[\s\S]*?const resetWcsToBaselineViaV2/,
);
if (!dispatchBlockMatch) {
  throw new Error('ConnectionPanelMain is missing the v2 intent dispatch block');
}
if (/G10 L2|\$10=0/.test(dispatchBlockMatch[0])) {
  throw new Error('v2 WCS intent dispatch block must not contain raw GRBL WCS command text');
}
