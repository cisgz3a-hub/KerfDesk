// @vitest-environment node
// Rolling audit v11 W3-P1-1: a network session the window can no longer reach
// still drives the controller, and closing its socket stops nothing. These run
// the real bridge, crash recovery and session-end guard against a loopback
// GRBL-family controller that answers a reset with its restart banner.
import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachineNetworkBridge } from './machine-network-bridge';
import type { MachineNetworkProtocol } from './machine-network-protocol';
import {
  installRendererCrashRecovery,
  type RendererGonePrompt,
  type RendererGoneReason,
} from './renderer-crash-recovery';
import { createDesktopJobActivity, installSessionEndGuard } from './session-end-guard';

const BANNERS: Record<MachineNetworkProtocol, string> = {
  'grblhal-raw': "\r\nGrblHAL 1.1f ['$' or '$HELP' for help]\r\n",
  'fluidnc-telnet': "\r\nGrbl 3.7 [FluidNC v3.7.17 (wifi) '$' for help]\r\n",
};
const JOB = 'G90 G21\nM3 S1000\nG0 X10 Y10\nG1 X50 F600\nG1 Y50\n';

const bridges: MachineNetworkBridge[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** What the controller saw, in order: bytes in, its banner out, and the host's end. */
type Wire = { kind: 'data'; bytes: Buffer } | { kind: 'banner' } | { kind: 'end' };

async function controller(protocol: MachineNetworkProtocol, answers = true) {
  const wire: Wire[] = [];
  let ended: () => void = () => undefined;
  const hostEnded = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
    socket.on('data', (bytes: Buffer) => {
      wire.push({ kind: 'data', bytes });
      if (answers && bytes.includes(0x18)) {
        wire.push({ kind: 'banner' });
        socket.write(BANNERS[protocol]);
      }
    });
    socket.on('end', () => {
      wire.push({ kind: 'end' });
      ended();
      if (answers) socket.end();
    });
    socket.on('close', ended);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no loopback port');
  const bridge = new MachineNetworkBridge();
  bridges.push(bridge);
  const { sessionId } = await bridge.open('127.0.0.1', address.port, protocol);
  return { bridge, sessionId, port: address.port, wire, hostEnded };
}

function bytesIn(wire: ReadonlyArray<Wire>): Buffer {
  return Buffer.concat(wire.flatMap((entry) => (entry.kind === 'data' ? [entry.bytes] : [])));
}

/** The bytes after the job, with the controller's banner and the host's end marked. */
function afterJob(wire: ReadonlyArray<Wire>): string {
  const all = wire
    .map((entry) =>
      entry.kind === 'data'
        ? entry.bytes.toString('latin1')
        : entry.kind === 'banner'
          ? '<banner>'
          : '<end>',
    )
    .join('');
  return all.slice(all.indexOf(JOB) + JOB.length).replace(/\x18/g, '<reset>');
}

function crashWindow() {
  const webContents = Object.assign(new EventEmitter(), { reload: vi.fn() });
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents,
  });
  const crash = (reason: RendererGoneReason): void => {
    webContents.emit('render-process-gone', {}, { reason });
  };
  return { window, crash };
}

describe('a renderer crash during a network job (W3-P1-1)', () => {
  it.each(['grblhal-raw', 'fluidnc-telnet'] as const)(
    'main sends the %s controller a reset, then M5 and M9 after its restart, before the socket ends',
    async (protocol) => {
      const { bridge, sessionId, port, wire, hostEnded } = await controller(protocol);
      await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
      const prompts: RendererGonePrompt[] = [];
      const { window, crash } = crashWindow();
      installRendererCrashRecovery(window, {
        isClosing: () => false,
        stopMachine: () => bridge.stopAll(),
        askToReload: async (prompt) => {
          prompts.push(prompt);
          return false;
        },
      });

      crash('oom');
      // The crashed page's session is released at once: Connect after Reload is not refused.
      expect(() => bridge.read(sessionId)).toThrow('unavailable');
      await hostEnded;
      await bridge.settled();

      expect(afterJob(wire)).toBe('<reset><banner>M5\nM9\n<end>');
      expect(prompts[0]?.detail).toContain('KerfDesk sent the network machine a reset');
      expect(prompts[0]?.detail).toContain('physical E-stop or power cutoff');
      const next = await bridge.open('127.0.0.1', port, protocol);
      expect(next.sessionId).not.toBe(sessionId);
    },
  );

  it('sends the stop even while a close attempt owns the prompt', async () => {
    const { bridge, sessionId, wire, hostEnded } = await controller('grblhal-raw');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    const askToReload = vi.fn(async () => false);
    const { window, crash } = crashWindow();
    installRendererCrashRecovery(window, {
      isClosing: () => true,
      stopMachine: () => bridge.stopAll(),
      askToReload,
    });
    crash('crashed');
    await hostEnded;
    await bridge.settled();
    expect(afterJob(wire)).toBe('<reset><banner>M5\nM9\n<end>');
    expect(askToReload).not.toHaveBeenCalled();
  });

  it('tells a USB operator the beam may still be on, E-stop first, when there was no network session', async () => {
    const bridge = new MachineNetworkBridge();
    bridges.push(bridge);
    const prompts: RendererGonePrompt[] = [];
    const { window, crash } = crashWindow();
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      stopMachine: () => bridge.stopAll(),
      askToReload: async (prompt) => {
        prompts.push(prompt);
        return false;
      },
    });
    crash('killed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const detail = prompts[0]?.detail ?? '';
    expect(detail).toContain('the beam or spindle may still be on');
    expect(detail.indexOf('physical E-stop or power cutoff')).toBeLessThan(
      detail.indexOf('reload KerfDesk'),
    );
    expect(detail).not.toContain('sent the network machine');
  });
});

describe('other closes no window stop precedes (W3-P1-1)', () => {
  it('the 15 s lease sends the stop before it closes a session nobody reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, sessionId, wire, hostEnded } = await controller('grblhal-raw');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    vi.advanceTimersByTime(14_999);
    expect(afterJob(wire)).toBe('');
    vi.advanceTimersByTime(1);
    await hostEnded;
    await bridge.settled();
    expect(afterJob(wire)).toBe('<reset><banner>M5\nM9\n<end>');
  });

  it('quitting after a forced close writes the reset, M5 and M9 at once', async () => {
    const { bridge, sessionId, wire, hostEnded } = await controller('fluidnc-telnet');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    bridge.dispose();
    await hostEnded;
    expect(afterJob(wire).replace('<banner>', '')).toBe('<reset>M5\nM9\n<end>');
  });

  it('a refused out-of-order write stops the controller before the socket goes', async () => {
    const { bridge, sessionId, wire, hostEnded } = await controller('grblhal-raw');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    await expect(
      bridge.write(sessionId, 3, Buffer.from('G1 X1\n').toString('base64')),
    ).rejects.toThrow('sequence');
    expect((await bridge.read(sessionId)).closed).toBe(true);
    await hostEnded;
    expect(afterJob(wire)).toBe('<reset><banner>M5\nM9\n<end>');
  });

  it('a controller that never answers still gets M5 and M9, and the socket goes within its bounds', async () => {
    const { bridge, sessionId, wire } = await controller('grblhal-raw', false);
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    const started = Date.now();
    bridge.stopAll();
    await bridge.settled();
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(bytesIn(wire).toString('latin1')).toBe(`${JOB}\x18M5\nM9\n`);
  });

  it("the window's own Close sends nothing: the store's stop came before it", async () => {
    const { bridge, sessionId, wire } = await controller('grblhal-raw');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    bridge.close(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(afterJob(wire)).not.toContain('<reset>');
  });
});

describe('Windows ending the session during network work (W3-P1-1, W3-P2-1)', () => {
  function sessionEndWindow() {
    const webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(async (_code: string) => undefined),
    });
    return Object.assign(new EventEmitter(), { webContents });
  }

  it('main sends the stop itself when the session ends while the window reports work', async () => {
    const { bridge, sessionId, wire, hostEnded } = await controller('grblhal-raw');
    await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
    const window = sessionEndWindow();
    const activity = createDesktopJobActivity();
    // A laser left on at Idle reports busy, as a job does (W3-P2-1).
    activity.set({ busy: true });
    const log = vi.fn();
    installSessionEndGuard(window, activity, log, () => bridge.stopAll(true));
    const query = { reasons: ['shutdown'], preventDefault: vi.fn() };
    window.emit('query-session-end', query);
    expect(query.preventDefault).toHaveBeenCalledOnce();
    expect(afterJob(wire)).toBe('');

    window.emit('session-end', { reasons: ['shutdown'], preventDefault: vi.fn() });
    // Written before the handler returned: Electron may end the process then.
    await hostEnded;
    expect(afterJob(wire).replace('<banner>', '')).toBe('<reset>M5\nM9\n<end>');
    expect(log).toHaveBeenCalledWith('Sent the network machine a reset, then M5 and M9.');
  });

  it('leaves an idle network session alone when Windows ends the session', async () => {
    const { bridge, sessionId, wire } = await controller('grblhal-raw');
    const window = sessionEndWindow();
    const activity = createDesktopJobActivity();
    installSessionEndGuard(window, activity, vi.fn(), () => bridge.stopAll());
    window.emit('session-end', { reasons: ['shutdown'], preventDefault: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bytesIn(wire)).toEqual(Buffer.alloc(0));
    await expect(bridge.read(sessionId)).resolves.toMatchObject({ closed: false });
  });
});
