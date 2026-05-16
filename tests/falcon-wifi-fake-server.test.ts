/**
 * T3-65: fake Falcon WiFi device server.
 *
 * These tests exercise the actual Falcon HTTP and WebSocket clients against a
 * local protocol fake instead of only source-level trust/profile helpers.
 *
 * Run: npx tsx tests/falcon-wifi-fake-server.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDeviceModel,
  getDeviceStatus,
  getFirmwareVersion,
  getLayerType,
  getSerialNumber,
  getWorkProgress,
  getWorkState,
  resolveFalconHttpTarget,
  testConnection,
} from '../electron/falcon-wifi/FalconHttpClient';
import { connectFalconWebSocket, resolveFalconWsTarget } from '../electron/falcon-wifi/FalconWebSocket';
import type { FalconWsEvent } from '../electron/falcon-wifi/FalconWiFiTypes';
import { FakeFalconServer } from './harness/fakeFalconServer';

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

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

console.log('\n=== T3-65 fake Falcon WiFi server ===\n');

void (async () => {
  {
    const server = new FakeFalconServer();
    await server.start({
      identity: {
        deviceModel: 'Falcon A1 Pro',
        firmwareVersion: 'V1.2.3',
        serialNumber: 'SN-FAKE-001',
        laserType: 'diode',
        laserClass: 'A1',
        zaxisVersion: 'Z9',
        laserSN: 'LASER-001',
      },
    });

    try {
      const target = server.httpTarget();
      assert(await getDeviceModel(target) === 'Falcon A1 Pro', 'HTTP model endpoint uses fake server');
      assert(await getFirmwareVersion(target) === 'V1.2.3', 'HTTP firmware endpoint uses fake server');
      assert(await getSerialNumber(target) === 'SN-FAKE-001', 'HTTP serial endpoint uses fake server');

      const layer = await getLayerType(target);
      assert(layer.laserType === 'diode', 'HTTP layer laserType mapped');
      assert(layer.laserSN === 'LASER-001', 'HTTP layer laserSN mapped');

      server.setHttpResponse('/work/state', { status: 200, body: { errorcode: 0, payload: { state: 8 } } });
      server.setHttpResponse('/work/progress', { status: 200, body: { errorcode: 0, payload: { progress: '42.5' } } });
      server.setHttpResponse('/device/state', { status: 200, body: { errorcode: 0, payload: { isBusy: true } } });
      server.setHttpResponse('/device/status', {
        status: 200,
        body: { errorcode: 0, payload: { devList: [{ module: 'printer', curState: 8 }] } },
      });

      assert(await getWorkState(target) === 8, 'HTTP work state endpoint can be scripted');
      assert(await getWorkProgress(target) === 42.5, 'HTTP progress endpoint parses scripted string number');
      const status = await getDeviceStatus(target);
      assert(status.isBusy === true, 'HTTP device busy state comes from fake server');
      assert(status.modules[0]?.module === 'printer', 'HTTP device status modules come from fake server');

      const conn = await testConnection(target);
      assert(conn.ok === true, 'testConnection succeeds against fake Falcon HTTP server');
      assert(conn.deviceModel === 'Falcon A1 Pro', 'testConnection reports model from fake server');
    } finally {
      await server.stop();
    }
  }

  {
    const server = new FakeFalconServer();
    await server.start();
    try {
      server.setHttpToFailWith('/system/getDeviceModel', 'malformed-json');
      let message = '';
      try {
        await getDeviceModel(server.httpTarget());
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/non-JSON body/.test(message), `malformed JSON surfaces clearly (got "${message}")`);

      server.setHttpResponse('/system/getDeviceModel', { status: 503, body: { errorcode: 0, payload: {} } });
      message = '';
      try {
        await getDeviceModel(server.httpTarget());
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/HTTP 503/.test(message), `scripted HTTP failure surfaces status (got "${message}")`);
    } finally {
      await server.stop();
    }
  }

  {
    const server = new FakeFalconServer();
    await server.start();
    try {
      server.setHttpResponse('/system/getDeviceModel', {
        status: 200,
        body: 'X'.repeat(2 * 1024 * 1024 + 1),
      });
      let message = '';
      try {
        await getDeviceModel(server.httpTarget());
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/response too large/i.test(message),
        `oversized Falcon HTTP body aborts with a size error (got "${message.slice(0, 120)}")`);
    } finally {
      await server.stop();
    }
  }

  {
    const server = new FakeFalconServer();
    await server.start();
    const events: FalconWsEvent[] = [];
    const handle = connectFalconWebSocket(server.wsTarget(), event => events.push(event));

    try {
      await waitUntil(() => events.some(event => event.kind === 'connection' && event.state === 'open'), 'ws open');
      server.emitWebSocketEvent({ kind: 'snapshot', modules: [{ module: 'printer', curState: 2 }] });
      server.emitWebSocketEvent({ kind: 'printer', curState: 8 });
      server.emitWebSocketEvent({ kind: 'alarm', type: 1, code: '01002002' });
      server.emitWebSocketText('{not-json');
      await waitUntil(() => events.some(event => event.kind === 'raw'), 'raw ws event');

      assert(events.some(event => event.kind === 'snapshot'), 'WebSocket snapshot event parsed');
      assert(events.some(event => event.kind === 'printer' && event.curState === 8), 'WebSocket printer event parsed');
      assert(events.some(event => event.kind === 'alarm' && event.code === '01002002'), 'WebSocket alarm event parsed');
      assert(events.some(event => event.kind === 'raw' && event.text === '{not-json'), 'malformed WebSocket payload becomes raw event');
    } finally {
      handle.close();
      await server.stop();
    }
  }

  {
    const server = new FakeFalconServer();
    server.setWebSocketMode('rejects-connect');
    await server.start();
    const events: FalconWsEvent[] = [];
    const handle = connectFalconWebSocket(server.wsTarget(), event => events.push(event));

    try {
      await waitUntil(
        () => events.some(event => event.kind === 'connection' && event.state === 'error'),
        'ws handshake rejection',
      );
      assert(
        events.some(event => event.kind === 'connection' && event.error?.includes('handshake rejected')),
        'WebSocket handshake rejection surfaces as connection error',
      );
    } finally {
      handle.close();
      await server.stop();
    }
  }

  {
    const httpDefault = resolveFalconHttpTarget('192.168.4.1');
    const wsDefault = resolveFalconWsTarget('192.168.4.1');
    const httpCustom = resolveFalconHttpTarget('127.0.0.1:18080');
    const wsCustom = resolveFalconWsTarget('127.0.0.1:11112');
    assert(httpDefault.port === 8080, `plain IP keeps Falcon HTTP default port (got ${httpDefault.port})`);
    assert(wsDefault.port === 11111, `plain IP keeps Falcon WebSocket default port (got ${wsDefault.port})`);
    assert(httpCustom.port === 18080, `host:port overrides HTTP port for tests (got ${httpCustom.port})`);
    assert(wsCustom.port === 11112, `host:port overrides WebSocket port for tests (got ${wsCustom.port})`);
  }

  {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, 'harness/fakeFalconServer.ts'), 'utf-8');
    const httpClient = readFileSync(resolve(here, '../electron/falcon-wifi/FalconHttpClient.ts'), 'utf-8');
    const wsClient = readFileSync(resolve(here, '../electron/falcon-wifi/FalconWebSocket.ts'), 'utf-8');
    assert(/class FakeFalconServer/.test(source), 'harness exports FakeFalconServer');
    assert(/setHttpResponse/.test(source), 'harness exposes HTTP response scripting');
    assert(/setHttpDelay/.test(source), 'harness exposes HTTP delay scripting');
    assert(/setHttpToFailWith/.test(source), 'harness exposes HTTP failure scripting');
    assert(/emitWebSocketEvent/.test(source), 'harness exposes WebSocket event scripting');
    assert(/setWebSocketMode/.test(source), 'harness exposes WebSocket mode scripting');
    assert(/scheduleReconnectScenario/.test(source), 'harness exposes reconnect scenario scripting');
    assert(/resolveFalconHttpTarget/.test(httpClient), 'HTTP client accepts host:port test targets');
    assert(/resolveFalconWsTarget/.test(wsClient), 'WebSocket client accepts host:port test targets');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
