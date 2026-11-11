import { randomUUID } from 'node:crypto';
import { Socket, isIP } from 'node:net';
import { MachineNetworkSession } from './machine-network-session.js';
import {
  validateMachineNetworkProtocol,
  type MachineNetworkProtocol,
} from './machine-network-protocol.js';

// A session the window can no longer reach still drives the controller. Main
// sends it the stop Disconnect sends before letting it go (rolling audit v11
// W3-P1-1): when the window's renderer is gone, when its reads stop for the
// lease, and when the app quits. Only the window's own Close, which follows
// the store's stop, closes without one.

/** What a stop of every session did: how many there were, and how many of
 *  them the reset was actually written to (rolling audit v12 X1-P3-1). */
export type MachineNetworkStop = { readonly sessions: number; readonly sent: number };

export class MachineNetworkBridge {
  private readonly sessions = new Map<string, MachineNetworkSession>();
  private pending: Socket | null = null;
  private readonly leases = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stopping = new Set<Promise<void>>();
  async open(
    host: string,
    port: number,
    protocol: MachineNetworkProtocol = 'fluidnc-telnet',
  ): Promise<{ readonly sessionId: string }> {
    validateMachineNetworkProtocol(protocol);
    validateNetworkTarget(host, port);
    // A stop still going out holds the controller's connection; it is bounded.
    while (this.stopping.size > 0) await Promise.all(this.stopping);
    if (this.pending !== null || this.sessions.size > 0)
      throw new Error('Disconnect the current network session before opening another.');
    const socket = new Socket();
    this.pending = socket;
    const session = new MachineNetworkSession(socket, protocol);
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
    // A stop the session sent itself (a refused write) may still be going out.
    if (session !== undefined) this.track(session.settled());
  }
  /** Stops and releases every session at once, so the next Connect is not
   *  refused. Each reset is written before this returns; the result says how
   *  many the OS took. `immediate` writes the whole stop now, for a process
   *  about to end. */
  stopAll(immediate = false): Promise<MachineNetworkStop> {
    this.pending?.destroy();
    this.pending = null;
    const resets = [...this.sessions.keys()].map((id) => this.stop(id, immediate));
    return Promise.all(resets).then((sent) => ({
      sessions: sent.length,
      sent: sent.filter(Boolean).length,
    }));
  }
  /** Resolves once every stop under way has gone out or given up. */
  async settled(): Promise<void> {
    while (this.stopping.size > 0) await Promise.all(this.stopping);
  }
  // The app is quitting: the stop is written synchronously, before it exits.
  dispose(): void {
    void this.stopAll(true);
  }
  private stop(id: string, immediate = false): Promise<boolean> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    clearTimeout(this.leases.get(id));
    this.leases.delete(id);
    if (session === undefined) return Promise.resolve(false);
    const reset = session.stopAndClose(
      'KerfDesk reset the controller and closed this network session.',
      { immediate },
    );
    this.track(session.settled());
    return reset;
  }
  private track(stopped: Promise<void>): void {
    this.stopping.add(stopped);
    void stopped.finally(() => this.stopping.delete(stopped));
  }
  private touch(id: string): void {
    if (!this.sessions.has(id)) return;
    clearTimeout(this.leases.get(id));
    // A crashed/closed renderer stops its local read loop; retain no orphan socket.
    const lease = setTimeout(() => void this.stop(id), 15_000);
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
    throw new Error('Enter the enabled machine network port (1–65535).');
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
