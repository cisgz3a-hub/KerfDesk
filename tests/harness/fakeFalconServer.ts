/**
 * T3-65: local Falcon WiFi protocol fake for HTTP + WebSocket tests.
 *
 * The real Falcon runs HTTP on :8080 and WebSocket on :11111. This fake uses
 * ephemeral ports by default and pairs with FalconNetworkTarget parsing so
 * tests can exercise the production clients without depending on hardware.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

import type {
  FalconDeviceModuleStatus,
  FalconWsEvent,
} from '../../electron/falcon-wifi/FalconWiFiTypes';
import { FALCON_STATE } from '../../electron/falcon-wifi/FalconWiFiEnums';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface FakeFalconIdentity {
  readonly deviceModel: string;
  readonly firmwareVersion: string;
  readonly serialNumber: string;
  readonly laserType: string;
  readonly laserClass: string;
  readonly zaxisVersion: string;
  readonly laserSN: string;
}

export interface FakeFalconStartOptions {
  readonly host?: string;
  readonly httpPort?: number;
  readonly wsPort?: number;
  readonly identity?: Partial<FakeFalconIdentity>;
}

export type FakeFalconHttpFailure = 'timeout' | 'connection-refused' | 'malformed-json';
export type FakeFalconWebSocketMode =
  | 'normal'
  | 'rejects-connect'
  | 'closes-after-handshake'
  | 'drops-events';
export type FakeFalconReconnectScenario =
  | 'immediate-success'
  | 'fail-3-then-succeed'
  | 'fail-forever';

interface ScriptedHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

const DEFAULT_IDENTITY: FakeFalconIdentity = {
  deviceModel: 'Falcon A1 Pro',
  firmwareVersion: 'FAKE-1.0.0',
  serialNumber: 'FAKE-SN',
  laserType: 'diode',
  laserClass: 'A1',
  zaxisVersion: 'Z0',
  laserSN: 'FAKE-LASER',
};

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

function listen(server: http.Server | net.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('FakeFalconServer did not receive a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server | net.Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function eventToWireText(event: FalconWsEvent | Record<string, unknown>): string {
  const maybe = event as FalconWsEvent;
  switch (maybe.kind) {
    case 'snapshot':
      return JSON.stringify({ modulelist: maybe.modules });
    case 'printer':
      return JSON.stringify({ module: 'printer', curState: maybe.curState });
    case 'safeDoor':
      return JSON.stringify({ module: 'safeDoor', curState: maybe.curState });
    case 'alarm':
      return JSON.stringify({ module: 'alarm', type: maybe.type, code: maybe.code });
    case 'module':
      return JSON.stringify({
        module: maybe.module,
        curState: maybe.curState,
        isExist: maybe.isExist,
      });
    case 'raw':
      return maybe.text;
    default:
      return JSON.stringify(event);
  }
}

export class FakeFalconServer {
  private host = '127.0.0.1';
  private httpPortValue = 0;
  private wsPortValue = 0;
  private identity: FakeFalconIdentity = DEFAULT_IDENTITY;
  private httpServer: http.Server | null = null;
  private wsServer: net.Server | null = null;
  private readonly httpSockets = new Set<net.Socket>();
  private readonly wsSockets = new Set<net.Socket>();
  private readonly openWsClients = new Set<net.Socket>();
  private readonly httpResponses = new Map<string, ScriptedHttpResponse>();
  private readonly httpDelays = new Map<string, number>();
  private readonly httpFailures = new Map<string, FakeFalconHttpFailure>();
  private webSocketMode: FakeFalconWebSocketMode = 'normal';
  private reconnectScenario: FakeFalconReconnectScenario | null = null;
  private wsConnectAttempts = 0;

  async start(options: FakeFalconStartOptions = {}): Promise<void> {
    if (this.httpServer || this.wsServer) throw new Error('FakeFalconServer is already running');

    this.host = options.host ?? '127.0.0.1';
    this.identity = { ...DEFAULT_IDENTITY, ...options.identity };

    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    this.httpServer.on('connection', socket => {
      this.httpSockets.add(socket);
      socket.on('close', () => this.httpSockets.delete(socket));
    });
    this.wsServer = net.createServer(socket => this.handleWsSocket(socket));

    this.httpPortValue = await listen(this.httpServer, this.host, options.httpPort ?? 0);
    this.wsPortValue = await listen(this.wsServer, this.host, options.wsPort ?? 0);
  }

  async stop(): Promise<void> {
    for (const socket of this.httpSockets) socket.destroy();
    for (const socket of this.wsSockets) socket.destroy();
    this.openWsClients.clear();
    await Promise.all([closeServer(this.httpServer), closeServer(this.wsServer)]);
    this.httpServer = null;
    this.wsServer = null;
  }

  httpPort(): number {
    return this.httpPortValue;
  }

  wsPort(): number {
    return this.wsPortValue;
  }

  httpTarget(): string {
    return `${this.host}:${this.httpPortValue}`;
  }

  wsTarget(): string {
    return `${this.host}:${this.wsPortValue}`;
  }

  setHttpResponse(path: string, response: ScriptedHttpResponse): void {
    this.httpResponses.set(normalizePath(path), response);
    this.httpFailures.delete(normalizePath(path));
  }

  setHttpDelay(path: string, ms: number): void {
    this.httpDelays.set(normalizePath(path), Math.max(0, ms));
  }

  setHttpToFailWith(path: string, error: FakeFalconHttpFailure): void {
    this.httpFailures.set(normalizePath(path), error);
  }

  setWebSocketMode(mode: FakeFalconWebSocketMode): void {
    this.webSocketMode = mode;
  }

  scheduleReconnectScenario(scenario: FakeFalconReconnectScenario): void {
    this.reconnectScenario = scenario;
    this.wsConnectAttempts = 0;
  }

  emitWebSocketEvent(event: FalconWsEvent | Record<string, unknown>): void {
    this.emitWebSocketText(eventToWireText(event));
  }

  emitWebSocketText(text: string): void {
    if (this.webSocketMode === 'drops-events') return;
    const frame = encodeWsTextFrame(text);
    for (const socket of Array.from(this.openWsClients)) {
      if (!socket.destroyed) socket.write(frame);
    }
  }

  private defaultResponse(path: string): ScriptedHttpResponse {
    const envelope = (payload: unknown): ScriptedHttpResponse => ({
      status: 200,
      body: { errorcode: 0, payload },
    });

    switch (path) {
      case '/system/getDeviceModel':
        return envelope({ deviceModel: this.identity.deviceModel });
      case '/system/getCurVersion':
        return envelope({ curversion: this.identity.firmwareVersion });
      case '/system/getSN':
        return envelope({ sn: this.identity.serialNumber });
      case '/work/getLayerType':
        return envelope({
          laserType: this.identity.laserType,
          laserClass: this.identity.laserClass,
          zaxisVersion: this.identity.zaxisVersion,
          laserSN: this.identity.laserSN,
        });
      case '/work/state':
        return envelope({ state: FALCON_STATE.IDLE });
      case '/work/progress':
        return envelope({ progress: '0' });
      case '/device/state':
        return envelope({ isBusy: false });
      case '/device/status':
        return envelope({
          devList: [{ module: 'printer', curState: FALCON_STATE.IDLE } satisfies FalconDeviceModuleStatus],
        });
      default:
        return { status: 404, body: { errorcode: 404, payload: { path } } };
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = new URL(req.url ?? '/', 'http://fake-falcon.local').pathname;
    const failure = this.httpFailures.get(path);
    if (failure === 'timeout') {
      return;
    }
    if (failure === 'connection-refused') {
      req.socket.destroy(new Error('Fake Falcon connection refused'));
      return;
    }

    const response =
      failure === 'malformed-json'
        ? { status: 200, body: '{not-json' }
        : this.httpResponses.get(path) ?? this.defaultResponse(path);

    const send = () => {
      const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      res.writeHead(response.status, {
        'Content-Type': 'text/html; charset=ISO-8859-1',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    };

    const delay = this.httpDelays.get(path) ?? 0;
    if (delay > 0) setTimeout(send, delay);
    else send();
  }

  private effectiveWsMode(): FakeFalconWebSocketMode {
    this.wsConnectAttempts++;
    if (this.reconnectScenario === 'fail-forever') return 'rejects-connect';
    if (this.reconnectScenario === 'fail-3-then-succeed' && this.wsConnectAttempts <= 3) {
      return 'rejects-connect';
    }
    return this.webSocketMode;
  }

  private handleWsSocket(socket: net.Socket): void {
    this.wsSockets.add(socket);
    socket.on('close', () => {
      this.wsSockets.delete(socket);
      this.openWsClients.delete(socket);
    });

    const mode = this.effectiveWsMode();
    let buffer = Buffer.alloc(0);

    socket.on('data', chunk => {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, chunkBuffer]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd).toString('utf8');
      if (mode === 'rejects-connect') {
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }

      const key = header.match(/^Sec-WebSocket-Key:\s*(.+)$/im)?.[1]?.trim();
      if (!key) {
        socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
        return;
      }

      const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          '\r\n',
      );
      this.openWsClients.add(socket);

      if (mode === 'closes-after-handshake') {
        socket.end();
      }
    });
  }
}
