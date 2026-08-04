import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectCanvasCompilationMainBridge,
  resetCanvasCompilationMainBridgeForTests,
} from './canvas-compilation-main-bridge';

class FakeOuterWorker {
  terminated = false;

  postMessage(): void {
    return;
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  resetCanvasCompilationMainBridgeForTests();
  vi.unstubAllGlobals();
});

describe('canvas compilation main bridge connection admission', () => {
  it('admits the five production outer sources and terminates a sixth', () => {
    const admitted = Array.from({ length: 5 }, () => new FakeOuterWorker());
    for (const worker of admitted) connectCanvasCompilationMainBridge(worker);
    const rejected = new FakeOuterWorker();

    expect(() => connectCanvasCompilationMainBridge(rejected)).toThrow('source capacity');
    expect(rejected.terminated).toBe(true);
    expect(admitted.every((worker) => !worker.terminated)).toBe(true);
  });

  it('terminates a newly-created outer worker when MessageChannel is unavailable', () => {
    vi.stubGlobal('MessageChannel', undefined);
    const worker = new FakeOuterWorker();

    expect(() => connectCanvasCompilationMainBridge(worker)).toThrow('bridge unavailable');
    expect(worker.terminated).toBe(true);
  });
});
