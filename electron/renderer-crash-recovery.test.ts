import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  installRendererCrashRecovery,
  RELOAD_BUTTON,
  rendererGonePrompt,
  type RendererGoneReason,
} from './renderer-crash-recovery';

function crashTarget() {
  const webContents = Object.assign(new EventEmitter(), { reload: vi.fn() });
  const window = { destroyed: false, isDestroyed: () => window.destroyed, webContents };
  const crash = (reason: RendererGoneReason): void => {
    webContents.emit('render-process-gone', {}, { reason });
  };
  return { window, crash };
}

const SENT = { sessions: 1, sent: 1 };

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer crash recovery', () => {
  it('offers a reload after a crash and reloads on request', async () => {
    const { window, crash } = crashTarget();
    const askToReload = vi.fn(async () => true);
    installRendererCrashRecovery(window, { isClosing: () => false, askToReload });

    crash('oom');
    await settle();

    expect(askToReload).toHaveBeenCalledWith(rendererGonePrompt('oom'));
    expect(window.webContents.reload).toHaveBeenCalledOnce();
  });

  it('keeps the window as it is when the operator says not now', async () => {
    const { window, crash } = crashTarget();
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      askToReload: async () => false,
    });
    crash('crashed');
    await settle();
    expect(window.webContents.reload).not.toHaveBeenCalled();
  });

  it('leaves a close attempt and a normal exit to their own owners', async () => {
    const { window, crash } = crashTarget();
    const askToReload = vi.fn(async () => true);
    let closing = true;
    installRendererCrashRecovery(window, { isClosing: () => closing, askToReload });

    crash('crashed');
    closing = false;
    crash('clean-exit');
    window.destroyed = true;
    crash('killed');
    await settle();

    expect(askToReload).not.toHaveBeenCalled();
  });

  // Rolling audit v11 W3-P1-1: the machine's stop waits on no prompt or close guard.
  it('stops the network machine on every renderer exit, before any prompt', async () => {
    const { window, crash } = crashTarget();
    let closing = false;
    const order: string[] = [];
    const stopMachine = vi.fn(async () => {
      order.push('stop');
      return SENT;
    });
    const askToReload = vi.fn(async () => {
      order.push('ask');
      return false;
    });
    installRendererCrashRecovery(window, { isClosing: () => closing, stopMachine, askToReload });

    crash('oom');
    await settle();
    expect(order).toEqual(['stop', 'ask']);
    expect(askToReload).toHaveBeenCalledWith(rendererGonePrompt('oom', SENT));
    closing = true;
    crash('crashed');
    crash('clean-exit');
    await settle();
    expect(stopMachine).toHaveBeenCalledTimes(3);
    expect(askToReload).toHaveBeenCalledOnce();
  });

  it('still asks when the stop throws, and says nothing was sent', async () => {
    const { window, crash } = crashTarget();
    const reportFailure = vi.fn();
    const askToReload = vi.fn(async () => false);
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      stopMachine: () => {
        throw new Error('socket gone');
      },
      askToReload,
      reportFailure,
    });
    crash('killed');
    await settle();
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(askToReload).toHaveBeenCalledWith(rendererGonePrompt('killed'));
  });

  // Rolling audit v12 X1-P2-1: the close guard is installed first and can block
  // main on a synchronous box; the stop must already be under way by then.
  it('runs the stop before a listener that was added first', () => {
    const { window, crash } = crashTarget();
    const order: string[] = [];
    window.webContents.on('render-process-gone', () => order.push('close guard box'));
    installRendererCrashRecovery(window, {
      isClosing: () => true,
      stopMachine: async () => {
        order.push('stop');
        return SENT;
      },
      askToReload: async () => false,
    });
    crash('crashed');
    expect(order).toEqual(['stop', 'close guard box']);
  });

  it('still asks when the stop rejects, and says nothing was sent', async () => {
    const { window, crash } = crashTarget();
    const reportFailure = vi.fn();
    const askToReload = vi.fn(async () => false);
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      stopMachine: () => Promise.reject(new Error('socket gone')),
      askToReload,
      reportFailure,
    });
    crash('killed');
    await settle();
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(askToReload).toHaveBeenCalledWith(rendererGonePrompt('killed'));
  });

  // Rolling audit v12 X1-P3-1: a session whose socket took no reset is not "sent".
  it('says so plainly when a network session took no stop', () => {
    const failed = rendererGonePrompt('crashed', { sessions: 1, sent: 0 }).detail;
    expect(failed).toContain('KerfDesk could not send the network machine a stop');
    expect(failed).not.toContain('sent the network machine a reset');
    expect(failed.indexOf('physical E-stop')).toBeLessThan(failed.indexOf('reload KerfDesk'));
  });

  it('says the beam or spindle may still be on, E-stop first', () => {
    const usb = rendererGonePrompt('crashed').detail;
    expect(usb).toContain('the beam or spindle may still be on');
    expect(usb).toContain('constant-power (M3) laser, a Fire beam or a spindle stays on');
    expect(usb.indexOf('physical E-stop')).toBeLessThan(usb.indexOf('reload KerfDesk'));
    expect(usb).not.toContain('may still finish');
    const network = rendererGonePrompt('crashed', SENT).detail;
    expect(network).toContain('sent the network machine a reset');
    expect(network).toContain('follows it with M5 and M9');
    expect(network.indexOf('physical E-stop')).toBeLessThan(network.indexOf('reload KerfDesk'));
  });

  it('asks once while a prompt is still open', async () => {
    const { window, crash } = crashTarget();
    let answer: (reload: boolean) => void = () => undefined;
    const askToReload = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    installRendererCrashRecovery(window, { isClosing: () => false, askToReload });

    crash('crashed');
    crash('crashed');
    // The prompt waits for the network stop's write (X1-P3-1).
    await settle();
    expect(askToReload).toHaveBeenCalledOnce();
    answer(true);
    await settle();
    crash('oom');
    await settle();

    expect(askToReload).toHaveBeenCalledTimes(2);
  });

  it('names Reload first and keeps the safety instruction', () => {
    const prompt = rendererGonePrompt('killed');
    expect(prompt.buttons[0]).toBe(RELOAD_BUTTON);
    expect(prompt.detail).toContain('physical E-stop or power cutoff');
    expect(prompt.detail).toContain('ended by the system');
  });
});
