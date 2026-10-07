import { randomUUID } from 'node:crypto';
import { Socket, isIP } from 'node:net';
import { MachineNetworkSession } from './machine-network-session.js';

export class MachineNetworkBridge {
  private readonly sessions = new Map<string, MachineNetworkSession>();
  private pending: Socket | null = null;
  private readonly leases = new Map<string, ReturnType<typeof setTimeout>>();
  async open(host: string, port: number): Promise<{ readonly sessionId: string }> {
    validateNetworkTarget(host, port);
    if (this.pending !== null || this.sessions.size > 0)
      throw new Error('Disconnect the current network session before opening another.');
    const socket = new Socket();
    this.pending = socket;
    const session = new MachineNetworkSession(socket);
    try {
      await connectSocket(socket, host, port);
      if (this.pending !== socket || socket.destroyed)
        throw new Error('Network connection attempt was cancelled.');
      const sessionId = randomUUID();
      this.sessions.set(sessionId, session);
      this.touch(sessionId);
      return { sessionId };
    } catch (error) {
      session.close();
      throw error;
    } finally {
      if (this.pending === socket) this.pending = null;
    }
  }
  read(id: string): ReturnType<MachineNetworkSession['read']> {
    this.touch(id);
    return this.session(id).read();
  }
  write(id: string, sequence: number, data: string): Promise<void> {
    this.touch(id);
    return this.session(id).write(sequence, data);
  }
  close(id: string): void {
    const session = this.sessions.get(id);
    session?.close();
    this.sessions.delete(id);
    clearTimeout(this.leases.get(id));
    this.leases.delete(id);
  }
  dispose(): void {
    this.pending?.destroy();
    this.pending = null;
    for (const id of this.sessions.keys()) this.close(id);
  }
  private touch(id: string): void {
    if (!this.sessions.has(id)) return;
    clearTimeout(this.leases.get(id));
    // A crashed/closed renderer stops its local read loop; retain no orphan socket.
    const lease = setTimeout(() => this.close(id), 15_000);
    lease.unref();
    this.leases.set(id, lease);
  }
  private session(id: string): MachineNetworkSession {
    const session = this.sessions.get(id);
    if (session === undefined)
      throw new Error('Network session is unavailable. Connect explicitly to start a new session.');
    return session;
  }
}

export function validateNetworkTarget(host: string, port: number): void {
  if (
    host.length === 0 ||
    host.length > 253 ||
    host.trim() !== host ||
    (!isIP(host) &&
      !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(
        host,
      ))
  )
    throw new Error('Enter a machine IP address or hostname, without a URL, path or credentials.');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Enter the enabled FluidNC Telnet/Port value (1–65535).');
}

function connectSocket(socket: Socket, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Network connection timed out.'));
    }, 5000);
    const fail = (): void => {
      clearTimeout(timer);
      reject(new Error('Could not open the configured network channel.'));
    };
    socket.once('error', fail);
    socket.once('close', fail);
    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.off('error', fail);
      socket.off('close', fail);
      resolve();
    });
  });
}
