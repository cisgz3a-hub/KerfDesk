/**
 * T3-69: first-run guide app wiring.
 *
 * Run: npx tsx tests/first-run-guide-wiring.test.ts
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

const app = readFileSync('src/ui/components/App.tsx', 'utf-8');
const bridge = readFileSync('src/ui/components/AppFirstRunGuideBridge.tsx', 'utf-8');
const guide = readFileSync('src/ui/components/FirstRunGuide.tsx', 'utf-8');
const wizardHandlers = readFileSync('src/ui/hooks/useWizardHandlers.ts', 'utf-8');
const dialogsStore = readFileSync('src/ui/stores/appDialogsStore.ts', 'utf-8');

console.log('\n=== T3-69 first-run guide wiring ===\n');

{
  assert(dialogsStore.includes('showFirstRunGuide: boolean'), 'dialogs store exposes showFirstRunGuide state');
  assert(dialogsStore.includes('setShowFirstRunGuide'), 'dialogs store exposes first-run guide setter');
  assert(/showFirstRunGuide:\s*false/.test(dialogsStore), 'first-run guide is hidden by default');
}

{
  assert(wizardHandlers.includes('shouldShowFirstRunGuide'), 'wizard completion checks first-run guide storage');
  assert(wizardHandlers.includes('setShowFirstRunGuide?.(true)'), 'wizard completion opens first-run guide when needed');
  const skipStart = wizardHandlers.indexOf('const handleWizardSkip');
  const skipEnd = wizardHandlers.indexOf('return {', skipStart);
  const skipBody = wizardHandlers.slice(skipStart, skipEnd);
  assert(!skipBody.includes('setShowFirstRunGuide'), 'wizard skip does not force the guide open');
}

{
  assert(app.includes('AppFirstRunGuideBridge'), 'App renders the first-run guide bridge');
  assert(app.includes('setShowFirstRunGuide: dialogs.setShowFirstRunGuide'), 'App passes the guide setter to wizard handlers');
}

{
  assert(bridge.includes('createFirstRunTestScene'), 'bridge loads the built-in first-run test scene');
  assert(bridge.includes('markFirstRunGuideComplete'), 'bridge persists guide completion');
  assert(bridge.includes('setShowConnection(true)'), 'bridge opens the real machine panel instead of duplicating controls');
  assert(bridge.includes('React.createElement(FirstRunGuide'), 'bridge renders the guide component');
}

{
  assert(guide.includes('data-testid\': \'first-run-guide\''), 'guide has a stable root test id');
  assert(guide.includes('first-run-guide-load-test-scene'), 'guide exposes a load-test-scene action');
  assert(guide.includes('first-run-guide-open-machine-panel'), 'guide exposes a machine-panel action');
  assert(guide.includes('Skip guide'), 'guide gives an explicit skip affordance');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
