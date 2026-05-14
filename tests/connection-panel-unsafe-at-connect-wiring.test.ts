/**
 * T3-91 follow-up: the unsafe-at-connect banner must be wired into the
 * live connected drawer, not only exist as an isolated component.
 *
 * Run: npx tsx tests/connection-panel-unsafe-at-connect-wiring.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const controls = readFileSync(resolve(root, 'src/ui/components/ConnectionControls.tsx'), 'utf-8');

console.log('\n=== T3-91 unsafe-at-connect live panel wiring ===\n');

assertContract(
  /UnsafeAtConnectBanner/.test(panel),
  'ConnectionPanelMain imports and renders UnsafeAtConnectBanner',
);
assertContract(
  /type\s+UnsafeAtConnectActionKind/.test(panel),
  'ConnectionPanelMain imports the typed unsafe-at-connect action kind',
);
assertContract(
  /const\s+unsafeAtConnectVerdict\s*=\s*controllerRef\.current\?\.getUnsafeAtConnect\?\.\(\)\s*\?\?\s*null/.test(panel),
  'ConnectionPanelMain reads the live controller unsafe-at-connect verdict',
);
assertContract(
  /const\s+handleUnsafeAtConnectAction\s*=\s*useCallback/.test(panel),
  'ConnectionPanelMain defines a dedicated unsafe-at-connect action handler',
);
assertContract(
  /case\s+['"]reset['"][\s\S]{0,180}handleUnlock\(\)/.test(panel),
  'reset action routes through the existing confirmed Unlock path',
);
assertContract(
  /case\s+['"]reconnect['"][\s\S]{0,220}machineService\.disconnect\(\)/.test(panel),
  'reconnect action routes through MachineService.disconnect',
);
assertContract(
  /case\s+['"]m5['"][\s\S]{0,220}executionCoordinator\.emergencyLaserOff\(\)/.test(panel),
  'M5 action routes through the structured laser-off path',
);
assertContract(
  /unsafeAtConnectBanner:\s*detailsPanel == null \? unsafeAtConnectBanner : null/.test(panel),
  'ConnectionPanelMain passes the banner into the header only in the main panel view',
);
assertContract(
  /unsafeAtConnectBanner\?:\s*React\.ReactNode/.test(controls),
  'ConnectionControls accepts an unsafe-at-connect banner slot',
);
assertContract(
  /unsafeAtConnectBanner,\s*laserModeBanner,\s*connectSection/.test(controls)
  && /faultedBanner,\s*unsafeAtConnectBanner,\s*laserModeBanner/.test(controls),
  'ConnectionControls renders unsafe-at-connect banner between fault and laser-mode banners',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
