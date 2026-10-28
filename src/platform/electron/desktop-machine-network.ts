import type { MachineNetworkAdapter, SerialConnection, SerialOpenRequest } from '../types';
import { wireEncodingError } from '../../core/controllers/serial-wire-encoding';
import {
  MACHINE_NETWORK_ROUTE,
  machineNetworkRequest,
  type MachineNetworkRequest,
} from './desktop-machine-network-api';
const MAX_NETWORK_LINE_LENGTH = 64 * 1024;

/** Streams an open session from a worker the app's root entry supplies
 * (ADR-675), since platform/electron cannot reach platform/web. The worker
 * reads and writes the session itself, through `route`. Null when it could
 * not start before it touched the session: the window then streams it. */
export type HostedNetworkSessionOpener = (args: {
  readonly sessionId: string;
  readonly route: { readonly url: string; readonly header: string };
}) => Promise<SerialConnection | null>;

/** `hostSession` streams a session from a worker (ADR-675). Without it, or
 * when its worker cannot start, the window streams the session itself. */
export function createDesktopMachineNetwork(
  request: MachineNetworkRequest = machineNetworkRequest(),
  hostSession?: HostedNetworkSessionOpener,
): MachineNetworkAdapter {
  return {
    serialForTarget: (host, port, protocol = 'fluidnc-telnet') => ({
      transport: 'tcp',
      isSupported: () => true,
      picksEndOnRestart: true,
      requestPort: async () => ({
        info: { transport: 'tcp' },
        open: async (req?: SerialOpenRequest) => {
          const result = await request('open', { host, port, protocol });
          const id = result['sessionId'];
          if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
            throw new Error('Invalid desktop network session.');
          const hostingRequested = req?.hostedStreaming === true;
          if (hostingRequested && hostSession !== undefined) {
            const hosted = await hostSession({
              sessionId: id,
              route: MACHINE_NETWORK_ROUTE,
            }).catch(async (error: unknown) => {
              await request('close', { sessionId: id }).catch(() => undefined);
              throw error;
            });
            if (hosted !== null) return hosted;
          }
          return new DesktopMachineConnection(request, id, hostingRequested);
        },
      }),
    }),
  };
}

class DesktopMachineConnection implements SerialConnection {
  private readonly lines = new Set<(line: string) => void>();
  private readonly closes = new Set<() => void>();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private partialLine = '';
  private closed = false;
  private reading = false;
  private sequence = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  /** True when a worker was asked for and could not take the session. */
  readonly backgroundStreamingUnavailable: boolean;
  constructor(
    private readonly request: MachineNetworkRequest,
    private readonly id: string,
    hostingRequested: boolean,
  ) {
    this.backgroundStreamingUnavailable = hostingRequested;
  }
  onLine(handler: (line: string) => void): () => void {
    this.lines.add(handler);
    if (!this.reading && !this.closed) {
      this.reading = true;
      void this.readLoop();
    }
    return () => this.lines.delete(handler);
  }
  onClose(handler: () => void): () => void {
    if (this.closed) queueMicrotask(handler);
    else this.closes.add(handler);
    return () => this.closes.delete(handler);
  }
  write(data: string): Promise<void> {
    const bytes = machineWireBytes(data);
    if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024)
      return Promise.reject(new Error('Network writes must contain 1–65536 wire bytes.'));
    const operation = this.writeQueue.then(async () => {
      if (this.closed) throw new Error('Network connection is closed.');
      this.sequence += 1;
      try {
        await this.request('write', {
          sessionId: this.id,
          sequence: this.sequence,
          data: encodeBase64(bytes),
        });
      } catch (error) {
        await this.close();
        throw error;
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.partialLine = '';
    for (const handler of this.closes) {
      try {
        handler();
      } catch (error) {
        console.error('Network close handler threw; continuing transport cleanup:', error);
      }
    }
    this.lines.clear();
    this.closes.clear();
    // Closing may fail after renderer/network loss; the native lease also expires.
    await this.request('close', { sessionId: this.id }).catch(() => undefined);
  }
  private async readLoop(): Promise<void> {
    try {
      while (!this.closed) {
        const result = await this.request('read', { sessionId: this.id });
        if (this.closed) return;
        const payload = result['data'];
        if (typeof payload !== 'string' || payload.length > 700_000)
          throw new Error('Invalid network read response.');
        // A closing read still carries the controller's last lines (ALARM, error).
        this.deliverLines(this.decoder.decode(decodeBase64(payload), { stream: true }));
        if (result['closed'] === true) {
          const reason = result['error'];
          if (typeof reason === 'string') console.warn(`Network controller session: ${reason}`);
          await this.close();
          return;
        }
      }
    } catch {
      await this.close();
    }
  }
  private deliverLines(chunk: string): void {
    const parts = chunk.split('\n');
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? '';
      if (this.partialLine.length + part.length > MAX_NETWORK_LINE_LENGTH + 1)
        throw new Error('Network controller line exceeds its local limit.');
      this.partialLine += part;
      if (index < parts.length - 1) {
        const line = this.partialLine.replace(/\r$/, '');
        if (line.length > MAX_NETWORK_LINE_LENGTH)
          throw new Error('Network controller line exceeds its local limit.');
        this.partialLine = '';
        for (const handler of this.lines) handler(line);
      }
    }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function machineWireBytes(data: string): Uint8Array {
  const error = wireEncodingError(data);
  if (error !== null) throw error;
  return Uint8Array.from(data, (char) => char.charCodeAt(0));
}
function decodeBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}
