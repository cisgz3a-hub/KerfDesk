import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { open2dSimulatorFromSource, open2dSimulatorFromText } from './gcode-open-action';
import type { ImportWorkerRequest, ImportWorkerResponse } from '../import/import-worker-protocol';
import { resetImportWorkerForTests } from '../import/import-worker-client';
import { parseGcodeBlob } from '../import/parse-gcode-blob';
import { packGcodeResult } from '../import/packed-gcode-result';

beforeEach(() => {
  resetStore();
  useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
});

afterEach(() => {
  resetImportWorkerForTests();
  vi.unstubAllGlobals();
});

describe('2D imported program timing handoff', () => {
  it('passes source-owned timing beside geometry, retaining external feed changes', () => {
    const open = vi.fn();
    for (const feed of [60, 6000]) {
      open2dSimulatorFromText('part.nc', `G21 G90\nG1 X100 F${feed}`, open, vi.fn());
    }
    expect(open.mock.calls[0]?.[2]).toMatchObject({ estimate: { kind: 'estimated' } });
    const slow = open.mock.calls[0]?.[2].estimate.totalSeconds as number;
    const fast = open.mock.calls[1]?.[2].estimate.totalSeconds as number;
    expect(slow).toBeGreaterThan(fast * 10);
    expect(slow).toBeGreaterThan(100);
  });

  it('retains the path but marks unsupported timing unavailable', () => {
    const open = vi.fn();
    open2dSimulatorFromText('unknown.nc', 'G21\nG81 X10 F60', open, vi.fn());
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[1].totalLength).toBeGreaterThan(0);
    expect(open.mock.calls[0]?.[2]).toMatchObject({
      estimate: { kind: 'preparation-failed' },
      timeline: null,
    });
  });

  it('captures Inspector timing assumptions and carries them through the Blob worker handoff', async () => {
    let request: ImportWorkerRequest | undefined;
    class TestWorker {
      static instance: TestWorker;
      onmessage: ((event: MessageEvent<ImportWorkerResponse>) => void) | null = null;
      constructor() {
        TestWorker.instance = this;
      }
      postMessage(value: ImportWorkerRequest) {
        request = value;
      }
      terminate() {
        return undefined;
      }
    }
    vi.stubGlobal('Worker', TestWorker);
    const open = vi.fn();
    const source = new NodeBlob(['G21\nG1 X100 F60']) as unknown as Blob;
    const timing = {
      limits: { accelMmPerSec2: 100, junctionDeviationMm: 0.01, maxFeedMmPerMin: 600 },
      deviceName: 'Captured Inspector CNC',
      cutTimeScale: 2,
    };
    const pending = open2dSimulatorFromSource(
      'worker.nc',
      { kind: 'blob', blob: source, timing, machineKind: 'cnc' },
      open,
      vi.fn(),
    );
    expect(request?.kind).toBe('gcode');
    if (request?.kind !== 'gcode') throw new Error('missing worker request');
    const worker = TestWorker.instance;
    expect(request.blob).toBe(source);
    expect(request.timingContext?.timing).toBe(timing);
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, device: { ...project.device, name: 'Changed background machine' } },
    });
    const result = await parseGcodeBlob(request.blob, undefined, request.timingContext);
    worker.onmessage?.({
      data: { id: request.id, kind: 'gcode', result: packGcodeResult(result) },
    } as MessageEvent<ImportWorkerResponse>);
    await pending;
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[2].description).toContain('Captured Inspector CNC');
    expect(open.mock.calls[0]?.[2].estimate.totalSeconds).toBeGreaterThan(200);
  });
});
