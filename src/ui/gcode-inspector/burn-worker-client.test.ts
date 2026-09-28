import { describe, expect, it } from 'vitest';
import type { BurnMoves } from './burn-grid';
import { startBurnWorker } from './burn-worker-client';
import type { BurnWorkerRequest, BurnWorkerResponse } from './burn-worker-protocol';

class StubWorker {
  onmessage: ((event: MessageEvent<BurnWorkerResponse>) => void) | null = null;
  readonly posted: BurnWorkerRequest[] = [];
  readonly transferred: Transferable[][] = [];
  terminated = false;

  postMessage(request: BurnWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transferred.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: BurnWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BurnWorkerResponse>);
  }
}

const MOVES: BurnMoves = {
  segmentCount: 1,
  positions: new Float32Array([0, 0, 0, 10, 0, 0]),
  segKind: new Uint8Array([1]),
  segPower: new Float32Array([800]),
};

const READY: BurnWorkerResponse = {
  kind: 'ready',
  layout: { originX: 0, originY: 0, mmPerCell: 1, columns: 1, rows: 1, z: 0 },
};

function burned(index: number): BurnWorkerResponse {
  return {
    kind: 'burned',
    target: { index, fraction: 0 },
    firstRow: 0,
    darkness: new Uint8Array(0),
  };
}

function start() {
  const worker = new StubWorker();
  const heard: BurnWorkerResponse[] = [];
  const client = startBurnWorker(
    { moves: MOVES, laser: { maxPowerS: 1000, spotMm: 0.1 } },
    (response) => heard.push(response),
    () => worker,
  );
  if (client === null) throw new Error('no client');
  return { worker, heard, client };
}

describe('the burn preview worker client (ADR-487)', () => {
  it('hands the worker its own copy of the moves and the laser', () => {
    const { worker } = start();
    const request = worker.posted[0];
    if (request?.kind !== 'start') throw new Error('no start');
    expect(request.moves.segPower).not.toBe(MOVES.segPower);
    expect([...request.moves.segPower]).toEqual([800]);
    expect(request.laser).toEqual({ maxPowerS: 1000, spotMm: 0.1 });
    expect(worker.transferred[0]).toContain(request.moves.positions.buffer);
    expect(MOVES.positions.length).toBe(6);
  });

  it('asks for only the latest burn while one is under way', () => {
    const { worker, heard, client } = start();
    client.burn({ index: 1, fraction: 0 });
    expect(worker.posted).toHaveLength(1);
    worker.reply(READY);
    expect(worker.posted[1]).toEqual({ kind: 'burn', target: { index: 1, fraction: 0 } });
    client.burn({ index: 2, fraction: 0 });
    client.burn({ index: 3, fraction: 0.5 });
    worker.reply(burned(1));
    expect(worker.posted[2]).toEqual({ kind: 'burn', target: { index: 3, fraction: 0.5 } });
    worker.reply(burned(3));
    expect(worker.posted).toHaveLength(3);
    expect(heard.map((response) => response.kind)).toEqual(['ready', 'burned', 'burned']);
  });

  it('asks nothing more of a worker with nothing to burn, and ignores a stopped one', () => {
    const { worker, heard, client } = start();
    worker.reply({ kind: 'none' });
    client.burn({ index: 1, fraction: 0 });
    expect(worker.posted).toHaveLength(1);
    client.dispose();
    worker.reply(READY);
    expect(worker.terminated).toBe(true);
    expect(heard).toHaveLength(1);
  });

  it('starts nothing where workers cannot run', () => {
    const laser = { maxPowerS: 1000, spotMm: 0.1 };
    expect(
      startBurnWorker(
        { moves: MOVES, laser },
        () => undefined,
        () => null,
      ),
    ).toBeNull();
  });
});
