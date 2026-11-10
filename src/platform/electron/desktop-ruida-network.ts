// The window's end of the desktop Ruida UDP link (ADR-697): datagrams go to
// the main process's bridge (electron/ruida-network-*.ts) over app:// routes,
// and a read loop brings the controller's replies back. The link carries
// datagrams only; the Ruida session state machine and the store above it
// decide what is sent, and nothing here ever resends.

import type { RuidaDatagramLink, RuidaNetworkAdapter } from '../ruida-network-types';
import {
  RUIDA_NETWORK_ROUTE,
  machineNetworkRequest,
  runningTimeDeadline,
  type MachineNetworkRequest,
} from './desktop-machine-network-api';

const MAX_DATAGRAM_BYTES = 1472;
const MAX_READ_DATAGRAMS = 256;

export function createDesktopRuidaNetwork(
  request: MachineNetworkRequest = machineNetworkRequest(fetch, RUIDA_NETWORK_ROUTE),
): RuidaNetworkAdapter {
  return {
    open: async (host, magic) => {
      const result = await request('open', { host, magic });
      const id = result['sessionId'];
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
        throw new Error('Invalid desktop Ruida session.');
      return new DesktopRuidaLink(request, id);
    },
    deadline: runningTimeDeadline,
  };
}

class DesktopRuidaLink implements RuidaDatagramLink {
  private readonly datagrams = new Set<(datagram: Uint8Array) => void>();
  private readonly closes = new Set<(reason?: string) => void>();
  private closed = false;
  private closeReason: string | undefined;
  private reading = false;
  private sequence = 0;
  private sendQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly request: MachineNetworkRequest,
    private readonly id: string,
  ) {}
  send(datagram: Uint8Array): Promise<void> {
    if (datagram.byteLength < 3 || datagram.byteLength > MAX_DATAGRAM_BYTES)
      return Promise.reject(new Error('A Ruida datagram holds 3–1472 bytes.'));
    const operation = this.sendQueue.then(async () => {
      if (this.closed) throw new Error('Ruida link is closed.');
      this.sequence += 1;
      await this.request('write', {
        sessionId: this.id,
        sequence: this.sequence,
        data: encodeBase64(datagram),
      });
    });
    this.sendQueue = operation.catch(() => undefined);
    return operation;
  }
  // Reading starts with the first listener, so no reply arrives unheard.
  onDatagram(handler: (datagram: Uint8Array) => void): () => void {
    this.datagrams.add(handler);
    if (!this.reading && !this.closed) {
      this.reading = true;
      void this.readLoop();
    }
    return () => this.datagrams.delete(handler);
  }
  onClose(handler: (reason?: string) => void): () => void {
    if (this.closed) queueMicrotask(() => handler(this.closeReason));
    else this.closes.add(handler);
    return () => this.closes.delete(handler);
  }
  async close(): Promise<void> {
    if (!this.end()) return;
    // The main process's lease also releases a session whose close is lost.
    await this.request('close', { sessionId: this.id }).catch(() => undefined);
  }
  private end(reason?: string): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.closeReason = reason;
    for (const handler of this.closes) {
      try {
        handler(reason);
      } catch (error) {
        console.error('Ruida close handler threw; continuing link cleanup:', error);
      }
    }
    this.closes.clear();
    this.datagrams.clear();
    return true;
  }
  private async readLoop(): Promise<void> {
    try {
      while (!this.closed) {
        const result = await this.request('read', { sessionId: this.id });
        if (this.closed) return;
        const datagrams = result['datagrams'];
        if (!Array.isArray(datagrams) || datagrams.length > MAX_READ_DATAGRAMS)
          throw new Error('Invalid Ruida read response.');
        for (const encoded of datagrams) this.deliver(encoded);
        if (result['closed'] === true) {
          const reason = result['error'];
          this.end(typeof reason === 'string' ? reason : undefined);
          return;
        }
      }
    } catch (error) {
      this.end(error instanceof Error ? error.message : 'Ruida link read failed.');
      await this.request('close', { sessionId: this.id }).catch(() => undefined);
    }
  }
  private deliver(encoded: unknown): void {
    if (typeof encoded !== 'string' || encoded.length > 2000)
      throw new Error('Invalid Ruida datagram.');
    const datagram = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    for (const handler of this.datagrams) handler(datagram);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}
