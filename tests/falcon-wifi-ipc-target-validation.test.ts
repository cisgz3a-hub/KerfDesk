/**
 * LFS-001: Falcon WiFi IPC must not let renderer input choose arbitrary
 * hostnames for main-process HTTP/WebSocket requests.
 *
 * Run: npx tsx tests/falcon-wifi-ipc-target-validation.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeFalconWifiIpcTarget } from '../electron/falcon-wifi/FalconTargetPolicy';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== LFS-001 Falcon WiFi IPC target validation ===\n');

for (const target of ['192.168.1.42', '10.0.0.5', '172.16.0.2', '172.31.255.254']) {
  const result = normalizeFalconWifiIpcTarget(target);
  assert(result.ok && result.target === target, `accepts private LAN target ${target}`);
}

{
  const result = normalizeFalconWifiIpcTarget(' 192.168.2.5 ');
  assert(result.ok && result.target === '192.168.2.5', 'trims private LAN target before use');
}

for (const target of [
  'example.com',
  'falcon.local',
  'localhost',
  '127.0.0.1',
  '8.8.8.8',
  '172.32.0.1',
  '169.254.1.10',
  'http://192.168.1.42',
  '192.168.1.42:8080',
  '192.168.1.42/work/state',
  '192.168.1.999',
  '',
  null,
]) {
  const result = normalizeFalconWifiIpcTarget(target);
  assert(!result.ok, `rejects renderer-supplied non-Falcon target ${String(target)}`);
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const service = readFileSync(
    resolve(here, '../electron/falcon-wifi/FalconWiFiService.ts'),
    'utf-8',
  );
  assert(
    service.includes('normalizeFalconWifiIpcTarget'),
    'Falcon WiFi IPC handlers call the main-process target policy',
  );
  assert(
    !/function isValidIp/.test(service),
    'Falcon WiFi IPC no longer uses permissive hostname validation',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
