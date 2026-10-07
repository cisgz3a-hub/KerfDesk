import type { MachineNetworkAdapter, SerialConnection } from '../types';
import { wireEncodingError } from '../../core/controllers/serial-wire-encoding';
import { machineNetworkRequest, type MachineNetworkRequest } from './desktop-machine-network-api';
const MAX_NETWORK_LINE_LENGTH = 64 * 1024;

export function createDesktopMachineNetwork(
  request: MachineNetworkRequest = machineNetworkRequest(),
): MachineNetworkAdapter {
  return {
    serialForTarget: (host, port) => ({
      isSupported: () => true,
      picksEndOnRestart: true,
      requestPort: async () => ({
        info: { transport: 'tcp' },
        open: async () => {
          const result = await request('open', { host, port, protocol: 'fluidnc-telnet' });
          const id = result['sessionId'];
          if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
            throw new Error('Invalid desktop network session.');
          return new DesktopMachineConnection(request, id);
        },
      }),
    }),
  };
}

class DesktopMachineConnection implements SerialConnection {
  readonly backgroundStreamingUnavailable = true;
  private readonly lines = new Set<(line: string) => void>();
  private readonly closes = new Set<() => void>();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private partialLine = '';
  private closed = false;
  private reading = false;
  private sequence = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly request: MachineNetworkRequest,
    private readonly id: string,
  ) {}
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
    for (const handler of this.closes) handler();
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
        if (result['closed'] === true) {
          await this.close();
          return;
        }
        const payload = result['data'];
        if (typeof payload !== 'string' || payload.length > 700_000)
          throw new Error('Invalid network read response.');
        const chunk = this.decoder.decode(decodeBase64(payload), { stream: true });
        this.deliverLines(chunk);
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
