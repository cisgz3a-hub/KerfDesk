// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RTSP_DESCRIBE_DEADLINE_MS,
  RTSP_DESCRIBE_IDLE_TIMEOUT_MS,
  sendRtspDescribe,
} from './rtsp-describe';
import { MAX_RTSP_DESCRIBE_HEADER_BYTES } from './rtsp-describe-response';

const URL = 'rtsp://192.168.10.1/live';
const COMPLETE = 'RTSP/1.0 200 OK\r\nContent-Length: 3\r\n\r\nv=0';

class FakeSocket extends EventEmitter {
  readonly destroy = vi.fn(() => {
    this.emit('close');
    return this;
  });
  readonly write = vi.fn();
  readonly setTimeout = vi.fn((_timeout: number, _callback: () => void) => this);
  readonly connect = vi.fn((_port: number, _host: string, listener: () => void) => {
    listener();
    return this;
  });
}

function probe(socket: FakeSocket): Promise<string> {
  return sendRtspDescribe('192.168.10.1', 554, URL, () => socket as unknown as Socket);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RTSP DESCRIBE socket lifetime', () => {
  it('sends the same DESCRIBE and closes a complete reply without waiting for socket end', async () => {
    const socket = new FakeSocket();
    const result = probe(socket);
    expect(socket.connect).toHaveBeenCalledWith(554, '192.168.10.1', expect.any(Function));
    expect(socket.write).toHaveBeenCalledWith(
      `DESCRIBE ${URL} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\n\r\n`,
    );
    socket.emit('data', Buffer.from(COMPLETE));
    await expect(result).resolves.toBe(COMPLETE);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces an overall deadline even when bytes keep arriving within the idle timeout', async () => {
    const socket = new FakeSocket();
    const result = probe(socket);
    const rejected = expect(result).rejects.toThrow('overall deadline');
    expect(socket.setTimeout).toHaveBeenCalledWith(
      RTSP_DESCRIBE_IDLE_TIMEOUT_MS,
      expect.any(Function),
    );
    socket.emit('data', Buffer.from('RTSP/1.0 200 OK\r\nX-Slow: '));
    for (let elapsed = 1000; elapsed < RTSP_DESCRIBE_DEADLINE_MS; elapsed += 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      socket.emit('data', Buffer.from('x'));
      expect(socket.destroy).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the separate inactivity timeout and clears the overall deadline on failure', async () => {
    const socket = new FakeSocket();
    const result = probe(socket);
    const rejected = expect(result).rejects.toThrow('RTSP probe timed out.');
    const timeout = socket.setTimeout.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(timeout).toBeTypeOf('function');
    timeout?.();
    await rejected;
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys the socket immediately when headers exceed the bound', async () => {
    const socket = new FakeSocket();
    const result = probe(socket);
    const rejected = expect(result).rejects.toThrow('headers are too large');
    socket.emit('data', Buffer.alloc(MAX_RTSP_DESCRIBE_HEADER_BYTES + 1));
    await rejected;
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['end', 'close'])('rejects a truncated 200 response on %s', async (event) => {
    const socket = new FakeSocket();
    const result = probe(socket);
    const rejected = expect(result).rejects.toThrow('before a complete DESCRIBE response');
    socket.emit('data', Buffer.from(COMPLETE.slice(0, -1)));
    socket.emit(event);
    await rejected;
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps transport errors terminal and ignores late data/error/end events', async () => {
    const socket = new FakeSocket();
    const result = probe(socket);
    const rejected = expect(result).rejects.toThrow('synthetic reset');
    socket.emit('error', new Error('synthetic reset'));
    socket.emit('data', Buffer.from(COMPLETE));
    socket.emit('end');
    socket.emit('error', new Error('late error'));
    await rejected;
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up an immediate connect failure', async () => {
    const socket = new FakeSocket();
    socket.connect.mockImplementation(() => {
      throw new Error('synthetic connect failure');
    });
    await expect(probe(socket)).rejects.toThrow('synthetic connect failure');
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
