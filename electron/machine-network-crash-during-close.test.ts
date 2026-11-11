// @vitest-environment node
// Rolling audit v12 X1-P2-1: the renderer dies while KerfDesk is closing. The
// close guard, installed first in main.ts, answers with a synchronous "App
// controls unavailable" box that blocks the main thread until the operator
// answers. Main's network stop must be written before that box opens. These run
// the real close guard (with its real box text), crash recovery and bridge, in
// main.ts's order, against a loopback controller.
import { EventEmitter } from 'node:events';
import { createServer, Socket, type Server } from 'node:net';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDesktopWindowClose } from './desktop-window-close';
import { MachineNetworkBridge } from './machine-network-bridge';
import { installRendererCrashRecovery, type RendererGonePrompt } from './renderer-crash-recovery';

const { box } = vi.hoisted(() => ({ box: vi.fn((_window: unknown, _options: unknown) => 0) }));
vi.mock('electron', () => ({ dialog: { showMessageBoxSync: box } }));

const JOB = 'G90 G21\nM3 S1000\nG1 X50 F600\n';
const bridges: MachineNetworkBridge[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  box.mockReset();
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function controller(dropAfterJob = false) {
  const received: Buffer[] = [];
  let ended: () => void = () => undefined;
  const hostEnded = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
    socket.on('data', (bytes: Buffer) => {
      received.push(bytes);
      if (bytes.includes(0x18)) socket.write("\r\nGrblHAL 1.1f ['$' or '$HELP' for help]\r\n");
      else if (dropAfterJob) socket.destroy();
    });
    socket.on('end', () => {
      ended();
      socket.end();
    });
    socket.on('close', ended);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no loopback port');
  const bridge = new MachineNetworkBridge();
  bridges.push(bridge);
  const { sessionId } = await bridge.open('127.0.0.1', address.port, 'grblhal-raw');
  await bridge.write(sessionId, 1, Buffer.from(JOB).toString('base64'));
  return { bridge, sessionId, received, hostEnded };
}

/** The main window as main.ts wires it: close guard first, crash recovery after. */
function mainWindow(bridge: MachineNetworkBridge) {
  const webContents = Object.assign(new EventEmitter(), {
    getURL: () => 'app://app/index.html',
    reload: vi.fn(),
    // The renderer's own close preparation never answers: it is about to die.
    executeJavaScript: vi.fn((_script: string) => new Promise<unknown>(() => undefined)),
  });
  const target = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    destroy: vi.fn(),
    close: vi.fn(() => target.emit('close', { preventDefault: vi.fn() })),
  });
  const guard = installDesktopWindowClose(target as unknown as BrowserWindow, {
    isTrustedRenderer: () => true,
    isQuitRequested: () => false,
    cancelQuit: vi.fn(),
    quit: vi.fn(),
  });
  const prompts: RendererGonePrompt[] = [];
  installRendererCrashRecovery(target, {
    isClosing: () => guard.isClosing(),
    stopMachine: () => bridge.stopAll(),
    askToReload: async (prompt) => {
      prompts.push(prompt);
      return false;
    },
  });
  const crash = (): void => {
    webContents.emit('render-process-gone', {}, { reason: 'oom' });
  };
  return { target, guard, prompts, crash };
}

const resetWritten = (write: {
  readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> };
}): boolean => write.mock.calls.some(([data]) => Buffer.isBuffer(data) && data.includes(0x18));

describe('a renderer crash while KerfDesk is closing (X1-P2-1)', () => {
  it("writes the reset before the close guard's blocking box opens, then M5 and M9", async () => {
    const { bridge, received, hostEnded } = await controller();
    const write = vi.spyOn(Socket.prototype, 'write');
    const { target, crash } = mainWindow(bridge);
    let resetBeforeBox: boolean | null = null;
    box.mockImplementation(() => {
      resetBeforeBox = resetWritten(write);
      return 0; // Keep app open
    });

    target.close();
    crash();

    expect(box).toHaveBeenCalledOnce();
    expect(resetBeforeBox).toBe(true);
    await hostEnded;
    await bridge.settled();
    const after = Buffer.concat(received).toString('latin1').slice(JOB.length);
    expect(after).toBe('\x18M5\nM9\n');
  });

  it('gives the E-stop as an instruction, not a condition, in that box', async () => {
    const { bridge } = await controller();
    const { target, crash } = mainWindow(bridge);
    target.close();
    crash();
    const detail = (box.mock.calls[0]?.[1] as { detail?: string } | undefined)?.detail ?? '';
    expect(detail).toContain('the beam or spindle may still be on');
    expect(detail).toContain('use the physical E-stop or power cutoff first');
    expect(detail).not.toContain('if the machine may be unsafe');
  });
});

describe('the crash prompt says only what was written (X1-P3-1)', () => {
  it('says the reset was sent once the socket took it', async () => {
    const { bridge } = await controller();
    const { crash, prompts } = mainWindow(bridge);
    crash();
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]?.detail).toContain('KerfDesk sent the network machine a reset');
  });

  it("says no stop went out when the session's connection had already failed", async () => {
    const { bridge, sessionId, hostEnded } = await controller(true);
    await hostEnded;
    // The window's read loop has not closed it yet; the bridge still holds it.
    await vi.waitFor(async () => expect((await bridge.read(sessionId)).closed).toBe(true));
    const { crash, prompts } = mainWindow(bridge);
    crash();
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    const detail = prompts[0]?.detail ?? '';
    expect(detail).toContain('KerfDesk could not send the network machine a stop');
    expect(detail).not.toContain('sent the network machine a reset');
    expect(detail.indexOf('physical E-stop')).toBeLessThan(detail.indexOf('reload KerfDesk'));
  });
});
