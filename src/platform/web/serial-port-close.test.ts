// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  requireSerialPortReleased,
  startSerialPortClose,
  startSerialPortForget,
} from './serial-port-close';

it.each(['stream release', 'native close'] as const)(
  'does not revoke permission after actual %s failure',
  async (stage) => {
    const failure = new Error('Cleanup failed');
    const port = {
      close: vi.fn(async () => {
        if (stage === 'native close') throw failure;
      }),
      forget: vi.fn(async () => undefined),
    };
    const closed = startSerialPortClose(port, async () => {
      if (stage === 'stream release') throw failure;
    });
    const forgotten = startSerialPortForget(port, closed);
    expect(() => requireSerialPortReleased(port)).toThrow('still closing');
    await expect(forgotten).rejects.toBe(failure);
    expect(port.forget).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledTimes(stage === 'native close' ? 1 : 0);
  },
);

it('retains ownership during reentrant revocation and reports its failure', async () => {
  const failure = new Error('Permission revoke failed');
  const port = {
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => {
      expect(() => requireSerialPortReleased(port)).toThrow('still closing');
      throw failure;
    }),
  };
  const closed = startSerialPortClose(port, async () => undefined);
  await expect(startSerialPortForget(port, closed)).rejects.toBe(failure);
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(port.forget).toHaveBeenCalledTimes(1);
  expect(() => requireSerialPortReleased(port)).not.toThrow();
});
