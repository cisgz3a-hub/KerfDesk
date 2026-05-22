/**
 * LF-EXT-CANDLE-006: command-capable surfaces must be trusted-boundary risks.
 *
 * Candle exposes command sending through multiple surfaces. LaserForge should
 * keep every comparable surface validated in trusted/service code, not only in
 * renderer controls.
 *
 * Run: npx tsx tests/trusted-command-boundary-contract.test.ts
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { normalizeFalconWifiIpcTarget } from '../electron/falcon-wifi/FalconTargetPolicy';
import { classifyUserCommand } from '../src/controllers/grbl/CommandClassifier';
import { checkHandlerCoverage } from '../src/security/TrustedSender';

console.log('\n=== LF-EXT-CANDLE-006 trusted command boundary contract ===\n');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert(haystack.includes(needle), `${message} (missing ${JSON.stringify(needle)})`);
}

{
  for (const target of ['192.168.1.42', '10.0.0.5', '172.16.0.10']) {
    const result = normalizeFalconWifiIpcTarget(target);
    assert(result.ok && result.target === target, `private LAN Falcon target accepted: ${target}`);
  }

  for (const target of [
    'example.com',
    'falcon.local',
    'localhost',
    '127.0.0.1',
    '8.8.8.8',
    'http://192.168.1.42',
    '192.168.1.42:8080',
    '192.168.1.42/work/state',
    null,
  ]) {
    const result = normalizeFalconWifiIpcTarget(target);
    assert(!result.ok, `renderer-controlled Falcon target rejected: ${String(target)}`);
  }
}

{
  const falconService = source('electron/falcon-wifi/FalconWiFiService.ts');
  const coverage = checkHandlerCoverage({
    source: falconService,
    guardName: 'assertTrustedSender',
    windowLines: 10,
  });
  assert(coverage.totalHandlers > 0, 'Falcon WiFi service has IPC handlers');
  assert.equal(coverage.unguarded.length, 0, 'Falcon WiFi IPC handlers verify sender frame');
  assertIncludes(falconService, 'normalizeFalconWifiIpcTarget(ip)', 'Falcon IPC handlers normalize target in main process');
  assertIncludes(falconService, "from './FalconTargetPolicy'", 'Falcon service imports the target policy directly');
}

{
  const main = source('electron/main.ts');
  const coverage = checkHandlerCoverage({
    source: main,
    guardName: 'assertTrustedSender',
    windowLines: 10,
  });
  assert(coverage.totalHandlers > 0, 'Electron main process has IPC handlers');
  assert.equal(coverage.unguarded.length, 0, 'Electron main IPC handlers verify sender frame');
  assertIncludes(main, 'nodeIntegration: false', 'renderer Node integration remains disabled');
  assertIncludes(main, 'contextIsolation: true', 'renderer context isolation remains enabled');
  assertIncludes(main, 'sandbox: true', 'renderer sandbox remains enabled');
}

{
  const classifierCases: Array<[string, 'safe' | 'warn' | 'dangerous']> = [
    ['G0 X0 M3 S500', 'warn'],
    ['G1 X10 M4 S300', 'warn'],
    ['G90 G10 L20 P1 X0 Y0', 'warn'],
    ['G0 G92 X0 Y0', 'warn'],
    ['G0 X0 ; M3 S500', 'safe'],
    ['G1 X1 (M4 S300)', 'safe'],
    ['$X', 'dangerous'],
    ['$RST=*', 'dangerous'],
  ];

  for (const [command, expected] of classifierCases) {
    assert.equal(
      classifyUserCommand(command).severity,
      expected,
      `manual command ${JSON.stringify(command)} classified as ${expected}`,
    );
  }
}

{
  const gateway = source('src/app/MachineCommandGateway.ts');
  const service = source('src/app/MachineService.ts');
  const panel = source('src/ui/components/ConnectionPanelMain.tsx');
  const workflow = source('src/ui/components/ConnectionPanel.tsx');

  assertIncludes(gateway, 'COMMAND_BLOCKED', 'service command gateway blocks unapproved user commands');
  assertIncludes(gateway, 'approval token is required', 'gateway requires approval token for warn/dangerous user commands');
  assertIncludes(gateway, 'token-replayed', 'gateway consumes approval tokens');
  assertIncludes(service, 'requestApproval(command: string)', 'MachineService issues command-bound approval tokens');
  assertIncludes(service, "classifyUserCommand(command)", 'MachineService classifies user commands at service boundary');
  assertIncludes(panel, "sendCommand(cmd, 'user', approvalToken)", 'legacy console sends user commands with service token');
  assertIncludes(
    workflow,
    "classification.severity === 'dangerous' || classification.severity === 'warn'",
    'workflow setup console refuses warn/dangerous commands instead of sending them directly',
  );
}

{
  const preload = source('electron/preload.ts');
  assert(!/\brequire\(/.test(preload), 'preload does not require Node modules');
  assert(!/from ['"](node:|fs|path|os|child_process|net|http|https)/.test(preload), 'preload imports no Node filesystem/network modules');
  assertIncludes(preload, 'contextBridge.exposeInMainWorld', 'preload exposes a narrow bridge');
  assert(!preload.includes('sendGcode'), 'preload does not expose a broad sendGcode IPC shortcut');
}

console.log('\nResult: trusted command boundary contract passed\n');
