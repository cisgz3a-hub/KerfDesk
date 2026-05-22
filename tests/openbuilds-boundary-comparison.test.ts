/**
 * LF-EXT-OBC-001: OpenBuilds CONTROL is a cautionary comparator for broad
 * local-server and Electron hardware-control surfaces.
 *
 * LaserForge must keep hardware-control APIs inside explicit Electron IPC,
 * Falcon target validation, Web Serial permission gates, and service-level
 * command approvals. It must not grow an unauthenticated Express/Socket.IO
 * LAN server for command-capable operations.
 *
 * Run: npx tsx tests/openbuilds-boundary-comparison.test.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strict as assert } from 'node:assert';
import { normalizeFalconWifiIpcTarget } from '../electron/falcon-wifi/FalconTargetPolicy';
import { classifyUserCommand } from '../src/controllers/grbl/CommandClassifier';
import { checkHandlerCoverage } from '../src/security/TrustedSender';

console.log('\n=== LF-EXT-OBC-001 OpenBuilds boundary comparison ===\n');

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), 'utf8');
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'audit' || entry === 'laserforge-external-repo-study') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry)) {
      yield full;
    }
  }
}

function assertNoSourceMatch(pattern: RegExp, message: string): void {
  const hits: string[] = [];
  for (const file of walk(repo)) {
    const rel = relative(repo, file).replace(/\\/g, '/');
    if (
      rel.startsWith('node_modules/')
      || rel.startsWith('dist/')
      || rel.startsWith('dist-electron/')
      || rel.startsWith('coverage/')
      || rel.startsWith('audit/')
      || rel === 'tests/openbuilds-boundary-comparison.test.ts'
    ) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (pattern.test(text)) hits.push(rel);
  }
  assert.equal(hits.length, 0, `${message}${hits.length ? `; hits=${hits.slice(0, 5).join(', ')}` : ''}`);
}

{
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  for (const disallowed of ['express', 'socket.io', 'cors', 'koa', 'fastify']) {
    assert(!(disallowed in deps), `no ${disallowed} dependency for a command-capable local server`);
  }
}

{
  assertNoSourceMatch(/\bapp\.listen\(\s*['"]0\.0\.0\.0['"]/, 'no Express-style server listening on 0.0.0.0');
  assertNoSourceMatch(/Access-Control-Allow-Private-Network/i, 'no broad private-network CORS header');
  assertNoSourceMatch(/\b(io|socket)\.on\(\s*['"](run|jog|test.?fire|pause|stop|reset|unlock|home)/i, 'no Socket.IO hardware-command handlers');
}

{
  const main = read('electron/main.ts');
  const falcon = read('electron/falcon-wifi/FalconWiFiService.ts');
  const mainCoverage = checkHandlerCoverage({ source: main, guardName: 'assertTrustedSender', windowLines: 10 });
  const falconCoverage = checkHandlerCoverage({ source: falcon, guardName: 'assertTrustedSender', windowLines: 10 });
  assert(mainCoverage.totalHandlers > 0, 'Electron main IPC handlers exist');
  assert.equal(mainCoverage.unguarded.length, 0, 'Electron main IPC handlers verify sender frame');
  assert(falconCoverage.totalHandlers > 0, 'Falcon WiFi IPC handlers exist');
  assert.equal(falconCoverage.unguarded.length, 0, 'Falcon WiFi IPC handlers verify sender frame');
  assert(main.includes('nodeIntegration: false'), 'Electron renderer keeps nodeIntegration disabled');
  assert(main.includes('contextIsolation: true'), 'Electron renderer keeps contextIsolation enabled');
  assert(main.includes('sandbox: true'), 'Electron renderer keeps sandbox enabled');
  assert(main.includes('setWindowOpenHandler'), 'Electron window-open navigation is intercepted');
  assert(main.includes('isTrustedElectronUrl(url)'), 'Electron navigation is allowed only through trusted URL helper');
}

{
  for (const target of ['example.com', 'falcon.local', 'localhost', '127.0.0.1', '8.8.8.8', '192.168.1.42:8080']) {
    assert(!normalizeFalconWifiIpcTarget(target).ok, `Falcon IPC rejects arbitrary target ${target}`);
  }
  assert(normalizeFalconWifiIpcTarget('192.168.1.42').ok, 'Falcon IPC accepts private LAN IPv4 device target');
}

{
  assert.equal(classifyUserCommand('G0 X0 M3 S500').severity, 'warn', 'embedded M3 laser-on command is classified');
  assert.equal(classifyUserCommand('G90 G10 L20 P1 X0 Y0').severity, 'warn', 'embedded G10 WCS command is classified');
  assert.equal(classifyUserCommand('$X').severity, 'dangerous', 'unlock command is dangerous');

  const gateway = read('src/app/MachineCommandGateway.ts');
  assert(gateway.includes('COMMAND_BLOCKED'), 'service command gateway blocks unapproved dangerous commands');
  assert(gateway.includes('token-replayed'), 'service command gateway prevents approval-token replay');
}

{
  const preload = read('electron/preload.ts');
  assert(preload.includes('contextBridge.exposeInMainWorld'), 'preload exposes explicit bridge');
  assert(!preload.includes('sendGcode'), 'preload has no broad sendGcode bridge');
  assert(!preload.includes('serial:send'), 'preload has no broad native serial send IPC');
}

console.log('\nResult: OpenBuilds boundary comparison passed\n');
