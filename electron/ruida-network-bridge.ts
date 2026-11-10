import { randomUUID } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import type { MachineNetworkStop } from './machine-network-bridge.js';
import { isAllowedPrivateNetworkHost } from './private-network-host-policy.js';
import { RuidaNetworkSession } from './ruida-network-session.js';
import {
  RUIDA_CONTROLLER_PORT,
  RUIDA_HOST_LISTEN_PORT,
  ruidaStopDatagram,
  validRuidaMagic,
} from './ruida-network-wire.js';

// The main process's Ruida UDP bridge (ADR-697), on the pattern of the TCP
// bridge (machine-network-bridge.ts): one session at a time, a read lease that
// stops a session whose window went quiet, and Stop Process sent on every
// session the window can no longer reach — a crashed renderer, a lease that
// ran out, the app quitting. Only the window's own Close, which follows the
// store's stop, closes without one.
//
// The controller answers to the host's port 40200 (meerk40t udp_transport.py
// L17-18), so the socket binds it; a second program holding that port
// (LightBurn, RDWorks) makes Connect fail plainly instead of sharing replies.

export type RuidaBridgePorts = {
  /** The controller's command port; 50200 on every Ruida. */
  readonly controllerPort?: number;
  /** The local port bound for replies; 40200, or 0 for an ephemeral port in tests. */
  readonly listenPort?: number;
};

const LEASE_MS = 15_000;

export class RuidaNetworkBridge {
  private readonly sessions = new Map<string, RuidaNetworkSession>();
  private pending: Socket | null = null;
  private readonly leases = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stopping = new Set<Promise<void>>();
  private readonly controllerPort: number;
  private readonly listenPort: number;
  constructor(ports: RuidaBridgePorts = {}) {
    this.controllerPort = ports.controllerPort ?? RUIDA_CONTROLLER_PORT;
    this.listenPort = ports.listenPort ?? RUIDA_HOST_LISTEN_PORT;
  }
  async open(host: string, magic: number): Promise<{ readonly sessionId: string }> {
    validateRuidaTarget(host);
    if (!validRuidaMagic(magic)) throw new Error('Invalid Ruida swizzle magic.');
    // A stop still going out holds the socket and its port; it is bounded.
    while (this.stopping.size > 0) await Promise.all(this.stopping);
    if (this.pending !== null || this.sessions.size > 0)
      throw new Error('Disconnect the current Ruida session before opening another.');
    const socket = createSocket({ type: 'udp4', reuseAddr: false });
    this.pending = socket;
    try {
      await bindSocket(socket, this.listenPort);
      if (this.pending !== socket) throw new Error('Ruida connection attempt was cancelled.');
      const session = new RuidaNetworkSession(socket, {
        host,
        port: this.controllerPort,
        stopDatagram: ruidaStopDatagram(magic),
      });
      const sessionId = randomUUID();
      this.sessions.set(sessionId, session);
      this.touch(sessionId);
      return { sessionId };
    } catch (error) {
      try {
        socket.close();
      } catch {
        // Never bound.
      }
      throw error;
    } finally {
      if (this.pending === socket) this.pending = null;
    }
  }
  read(id: string): ReturnType<RuidaNetworkSession['read']> {
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
    this.release(id);
    if (session !== undefined) this.track(session.settled());
  }
  /** Stops and releases every session; each stop is handed to the OS before
   *  this resolves, and the result says how many the OS took. */
  stopAll(): Promise<MachineNetworkStop> {
    this.pending = null;
    const stops = [...this.sessions.keys()].map((id) => this.stop(id));
    return Promise.all(stops).then((sent) => ({
      sessions: sent.length,
      sent: sent.filter(Boolean).length,
    }));
  }
  async settled(): Promise<void> {
    while (this.stopping.size > 0) await Promise.all(this.stopping);
  }
  // The app is quitting: the stop is handed to the OS before it exits.
  dispose(): void {
    void this.stopAll();
  }
  private stop(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    this.release(id);
    if (session === undefined) return Promise.resolve(false);
    const sent = session.stopAndClose('KerfDesk sent Stop Process and closed this Ruida session.');
    this.track(session.settled());
    return sent;
  }
  private release(id: string): void {
    this.sessions.delete(id);
    clearTimeout(this.leases.get(id));
    this.leases.delete(id);
  }
  private track(stopped: Promise<void>): void {
    this.stopping.add(stopped);
    void stopped.finally(() => this.stopping.delete(stopped));
  }
  private touch(id: string): void {
    if (!this.sessions.has(id)) return;
    clearTimeout(this.leases.get(id));
    // A crashed or closed window stops its read loop; no orphan session stays.
    const lease = setTimeout(() => void this.stop(id), LEASE_MS);
    lease.unref();
    this.leases.set(id, lease);
  }
  private session(id: string): RuidaNetworkSession {
    const session = this.sessions.get(id);
    if (session === undefined)
      throw new Error('Ruida session is unavailable. Connect explicitly to start a new session.');
    return session;
  }
}

/** A Ruida is reached by its panel-configured IPv4 address on the operator's
 *  own network: no hostnames (replies are matched by address), and no public
 *  address (private-network-host-policy.ts, as the camera bridge). */
export function validateRuidaTarget(host: string): void {
  if (isIP(host) !== 4 || !isAllowedPrivateNetworkHost(host))
    throw new Error(
      "Enter the controller's private-network IPv4 address as its panel shows it (for example 192.168.1.100).",
    );
}

function bindSocket(socket: Socket, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: NodeJS.ErrnoException): void => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `UDP port ${port} is in use on this computer. Close LightBurn, RDWorks or any other Ruida program, then connect again.`
            : 'Could not open the Ruida UDP port on this computer.',
        ),
      );
    };
    socket.once('error', fail);
    socket.bind({ port, exclusive: true }, () => {
      socket.off('error', fail);
      resolve();
    });
  });
}
