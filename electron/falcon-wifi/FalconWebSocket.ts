/**
 * Minimal WebSocket client for the Falcon A1 Pro (ws://<ip>:11111/).
 *
 * Why hand-rolled instead of the `ws` npm package?
 *   - Phase 1 brief mandates "no new runtime dependencies".
 *   - The Falcon's WS is trivial: no auth, no subprotocol, text frames only.
 *   - The `falcon-wifi-probe-v3.mjs` prototype already proved this exact
 *     handshake + parse loop works end-to-end; we port it here and add:
 *        * empty-frame keepalives (server sends every ~5 min) — emitted as
 *          kind:'raw' if non-empty, silently ignored if empty
 *        * ping/pong frame handling
 *        * auto-reconnect with bounded backoff
 *        * structured event callbacks instead of raw-text only
 *
 * Event shapes emitted on the wire from the Falcon (observed):
 *   { "module": "safeDoor", "curState": 0 }             — 0=closed, 1=open
 *   { "module": "printer",  "curState": 2 }              — state enum
 *   { "module": "alarm", "type": 0, "code": "01000000" } — ACK/heartbeat
 *   { "module": "alarm", "type": 1, "code": "01002002" } — warning
 *   { "modulelist": [ ... ] }                            — initial snapshot
 */

import net from 'node:net';
import crypto from 'node:crypto';

import type { FalconWsEvent, FalconDeviceModuleStatus } from './FalconWiFiTypes';

const WS_PORT = 11111;
const WS_PATH = '/';
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const RECONNECT_BACKOFF_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Public handle returned to callers so they can gracefully close. */
export interface FalconWsHandle {
  readonly ip: string;
  /** Close the socket and stop any pending reconnect. Idempotent. */
  close(): void;
  /** True until close() has been called. */
  isActive(): boolean;
}

interface InternalState {
  socket: net.Socket | null;
  buffer: Buffer;
  handshakeComplete: boolean;
  expectedAccept: string;
  closed: boolean;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  handshakeTimer: NodeJS.Timeout | null;
}

export function connectFalconWebSocket(
  ip: string,
  onEvent: (event: FalconWsEvent) => void,
): FalconWsHandle {
  const state: InternalState = {
    socket: null,
    buffer: Buffer.alloc(0),
    handshakeComplete: false,
    expectedAccept: '',
    closed: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    handshakeTimer: null,
  };

  const emit = (e: FalconWsEvent) => {
    if (state.closed) return;
    try {
      onEvent(e);
    } catch (err) {
      console.error('[falcon-ws] onEvent threw:', err);
    }
  };

  const clearTimers = () => {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.handshakeTimer) {
      clearTimeout(state.handshakeTimer);
      state.handshakeTimer = null;
    }
  };

  const scheduleReconnect = (reason: string) => {
    if (state.closed) return;
    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      emit({
        kind: 'connection',
        state: 'error',
        error: `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts (${reason})`,
      });
      return;
    }
    state.reconnectAttempts += 1;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      open();
    }, RECONNECT_BACKOFF_MS);
  };

  const destroySocket = () => {
    const s = state.socket;
    state.socket = null;
    state.handshakeComplete = false;
    state.buffer = Buffer.alloc(0);
    if (s) {
      try {
        s.removeAllListeners();
        s.destroy();
      } catch {
        /* ignore */
      }
    }
  };

  const handleMessageFrame = (payload: Buffer) => {
    const text = payload.toString('utf8');
    if (text.length === 0) return; // keepalive
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      emit({ kind: 'raw', text });
      return;
    }
    if (!obj || typeof obj !== 'object') {
      emit({ kind: 'raw', text });
      return;
    }
    const o = obj as Record<string, unknown>;

    if (Array.isArray(o.modulelist)) {
      const modules = (o.modulelist as unknown[]).filter(
        (m): m is FalconDeviceModuleStatus =>
          typeof m === 'object' && m !== null && typeof (m as { module?: unknown }).module === 'string',
      );
      emit({ kind: 'snapshot', modules });
      return;
    }

    const module = typeof o.module === 'string' ? o.module : undefined;
    if (module === 'printer' && typeof o.curState === 'number') {
      emit({ kind: 'printer', curState: o.curState });
      return;
    }
    if (module === 'safeDoor' && typeof o.curState === 'number') {
      emit({ kind: 'safeDoor', curState: o.curState });
      return;
    }
    if (module === 'alarm' && typeof o.type === 'number' && typeof o.code === 'string') {
      emit({ kind: 'alarm', type: o.type, code: o.code });
      return;
    }
    if (module) {
      emit({
        kind: 'module',
        module,
        curState: typeof o.curState === 'number' ? o.curState : undefined,
        isExist: typeof o.isExist === 'boolean' ? o.isExist : undefined,
      });
      return;
    }
    emit({ kind: 'raw', text });
  };

  const parseFrames = () => {
    const s = state.socket;
    if (!s) return;
    while (state.buffer.length >= 2) {
      const b1 = state.buffer[0];
      const b2 = state.buffer[1];
      const opcode = b1 & 0x0f;
      const masked = (b2 & 0x80) !== 0;
      let len = b2 & 0x7f;
      let hlen = 2;
      if (len === 126) {
        if (state.buffer.length < 4) return;
        len = state.buffer.readUInt16BE(2);
        hlen = 4;
      } else if (len === 127) {
        if (state.buffer.length < 10) return;
        const big = state.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          // Absurd frame size; reset and let reconnect handle it.
          destroySocket();
          scheduleReconnect('oversized frame');
          return;
        }
        len = Number(big);
        hlen = 10;
      }
      let maskKey: Buffer | null = null;
      if (masked) {
        if (state.buffer.length < hlen + 4) return;
        maskKey = Buffer.from(state.buffer.slice(hlen, hlen + 4));
        hlen += 4;
      }
      if (state.buffer.length < hlen + len) return;
      const payloadRaw = state.buffer.slice(hlen, hlen + len);
      let payload: Buffer;
      if (maskKey) {
        const mk = maskKey;
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) unmasked[i] = payloadRaw[i] ^ mk[i & 3];
        payload = unmasked;
      } else {
        payload = Buffer.from(payloadRaw);
      }
      state.buffer = state.buffer.slice(hlen + len);

      switch (opcode) {
        case 0x1: // text
          handleMessageFrame(payload);
          break;
        case 0x2: // binary — not expected, but don't blow up
          emit({ kind: 'raw', text: `<binary:${payload.length}B>` });
          break;
        case 0x8: // close
          emit({ kind: 'connection', state: 'closed' });
          try {
            s.end();
          } catch {
            /* ignore */
          }
          return;
        case 0x9: // ping — reply with pong
          try {
            const pong = Buffer.concat([Buffer.from([0x8a, payload.length & 0x7f]), payload]);
            s.write(pong);
          } catch {
            /* ignore */
          }
          break;
        case 0xa: // pong
          break;
        default:
          /* ignore unknown opcodes */
          break;
      }
    }
  };

  const open = () => {
    if (state.closed) return;
    emit({ kind: 'connection', state: 'connecting' });
    const key = crypto.randomBytes(16).toString('base64');
    state.expectedAccept = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');
    state.buffer = Buffer.alloc(0);
    state.handshakeComplete = false;

    const socket = net.connect(WS_PORT, ip, () => {
      if (state.closed) return;
      socket.write(
        `GET ${WS_PATH} HTTP/1.1\r\n` +
          `Host: ${ip}:${WS_PORT}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n',
      );
    });
    state.socket = socket;

    state.handshakeTimer = setTimeout(() => {
      state.handshakeTimer = null;
      if (!state.handshakeComplete && !state.closed) {
        destroySocket();
        scheduleReconnect('handshake timeout');
        emit({ kind: 'connection', state: 'error', error: 'WebSocket handshake timed out' });
      }
    }, HANDSHAKE_TIMEOUT_MS);

    socket.on('data', (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      if (!state.handshakeComplete) {
        const end = state.buffer.indexOf('\r\n\r\n');
        if (end === -1) return;
        const header = state.buffer.slice(0, end).toString('utf8');
        state.buffer = state.buffer.slice(end + 4);
        const ok =
          /HTTP\/1\.1\s+101/.test(header) &&
          header.toLowerCase().includes(state.expectedAccept.toLowerCase());
        if (!ok) {
          destroySocket();
          emit({ kind: 'connection', state: 'error', error: 'WebSocket handshake rejected' });
          scheduleReconnect('handshake rejected');
          return;
        }
        state.handshakeComplete = true;
        state.reconnectAttempts = 0;
        if (state.handshakeTimer) {
          clearTimeout(state.handshakeTimer);
          state.handshakeTimer = null;
        }
        emit({ kind: 'connection', state: 'open' });
      }
      parseFrames();
    });

    socket.on('close', () => {
      if (state.closed) return;
      const wasOpen = state.handshakeComplete;
      destroySocket();
      emit({ kind: 'connection', state: 'closed' });
      if (wasOpen) {
        state.reconnectAttempts = 0; // fresh budget after a clean open
      }
      scheduleReconnect('socket closed');
    });

    socket.on('error', (err) => {
      if (state.closed) return;
      emit({
        kind: 'connection',
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      // 'close' fires after 'error' and will handle reconnect scheduling.
    });
  };

  open();

  return {
    ip,
    close() {
      if (state.closed) return;
      state.closed = true;
      clearTimers();
      destroySocket();
    },
    isActive() {
      return !state.closed;
    },
  };
}
