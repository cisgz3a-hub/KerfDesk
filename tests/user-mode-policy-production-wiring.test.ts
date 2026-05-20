/**
 * F45-02-001: Beginner / Advanced user-mode policy must reach production UI paths.
 *
 * Run: npx tsx tests/user-mode-policy-production-wiring.test.ts
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

console.log('\n=== F45-02-001 user-mode policy production wiring ===\n');

{
  const src = read('src/app/UserModeGates.ts');
  assert(!src.includes('requireProfileConfirmationOnConnect'),
    'policy no longer claims an unwired profile-confirmation gate');
  assert(!src.includes('requireMaterialSafetyChecklist'),
    'policy no longer claims an unwired material-checklist gate');
  assert(!src.includes('showGcodeTemplateEditing'),
    'policy no longer claims unwired template-editing visibility');
  assert(!src.includes('maxTestFireDeadmanMs'),
    'policy no longer claims an unwired per-mode test-fire deadman');
  assert(!src.includes('recoveryCardsDismissable'),
    'policy no longer claims unwired recovery-card dismissability');
  assert(!src.includes('guidedSetupSkippable'),
    'policy no longer claims unwired setup skippability');
}

{
  const src = read('src/ui/components/ConnectionPanelMain.tsx');
  assert(src.includes('const showAdvancedConsole = userModeGatePolicy.showProductionConsole && userModeGatePolicy.showManualGcodeSend'),
    'legacy panel derives advanced console visibility from user-mode policy');
  assert(/advancedSection = isConnected && showAdvancedConsole && React\.createElement\(ConsolePanel/.test(src),
    'legacy panel hides ConsolePanel when policy disallows advanced console');
  assert(src.includes('showAdvanced: showAdvancedConsole'),
    'legacy details tabs receive policy-controlled advanced visibility');
}

{
  const src = read('src/ui/components/ConnectionPanel.tsx');
  assert(src.includes("computeUserModeGatePolicy(props.userMode ?? 'beginner')"),
    'WorkflowPanel adapter computes user-mode policy');
  assert(src.includes('const showSetupConsole = setupModePolicy.showProductionConsole && setupModePolicy.showManualGcodeSend'),
    'WorkflowPanel setup console visibility derives from policy');
  assert(src.includes('showConsole: showSetupConsole'),
    'WorkflowPanel setup props carry policy-controlled console visibility');
}

{
  const src = read('src/ui/components/workflow/modes/SetupMode.tsx');
  assert(src.includes('readonly showConsole?: boolean'),
    'SetupMode accepts a showConsole policy prop');
  assert(src.includes("ALL_SETUP_TABS.filter(tab => tab !== 'console')"),
    'SetupMode removes Console tab when policy disallows it');
  assert(src.includes("setActiveTab('move')"),
    'SetupMode falls back from a persisted Console tab when hidden');
}

{
  const src = read('src/ui/components/workflow/modes/setup/TabBar.tsx');
  assert(src.includes('readonly tabs?: readonly SetupTab[]'),
    'setup TabBar accepts a filtered tab list');
  assert(src.includes('tabs = ALL_SETUP_TABS'),
    'setup TabBar defaults to all tabs for advanced mode');
  assert(src.includes('...tabs.map'),
    'setup TabBar renders the filtered tab list');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
