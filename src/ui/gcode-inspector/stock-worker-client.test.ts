import { describe, expect, it } from 'vitest';
import type { StockMoves } from './stock-carving';
import { startStockWorker } from './stock-worker-client';
import type { StockWorkerRequest, StockWorkerResponse } from './stock-worker-protocol';

class StubWorker {
  onmessage: ((event: MessageEvent<StockWorkerResponse>) => void) | null = null;
  readonly posted: StockWorkerRequest[] = [];
  readonly transferred: Transferable[][] = [];
  terminated = false;

  postMessage(request: StockWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transferred.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: StockWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StockWorkerResponse>);
  }
}

const MOVES: StockMoves = {
  segmentCount: 1,
  positions: new Float32Array([0, 0, -1, 10, 0, -1]),
  segTool: new Uint16Array(1),
  tools: [null],
};

const READY: StockWorkerResponse = {
  kind: 'ready',
  layout: { originX: 0, originY: 0, widthMm: 1, heightMm: 1, mmPerCell: 1, bottomZ: -2 },
  columns: 1,
  rows: 1,
};

function carved(index: number): StockWorkerResponse {
  return {
    kind: 'carved',
    target: { index, fraction: 0 },
    firstRow: 0,
    depth: new Float32Array(0),
  };
}

function start() {
  const worker = new StubWorker();
  const heard: StockWorkerResponse[] = [];
  const client = startStockWorker(
    MOVES,
    (response) => heard.push(response),
    () => worker,
  );
  if (client === null) throw new Error('no client');
  return { worker, heard, client };
}

describe('the carved stock worker client (ADR-487)', () => {
  it('hands the worker its own copy of the moves', () => {
    const { worker } = start();
    const request = worker.posted[0];
    if (request?.kind !== 'start') throw new Error('no start');
    expect(request.moves.positions).not.toBe(MOVES.positions);
    expect([...request.moves.positions]).toEqual([...MOVES.positions]);
    expect(worker.transferred[0]).toContain(request.moves.positions.buffer);
    expect(MOVES.positions.length).toBe(6);
  });

  it('asks for only the latest carve while one is under way', () => {
    const { worker, heard, client } = start();
    client.carve({ index: 1, fraction: 0 });
    expect(worker.posted).toHaveLength(1);
    worker.reply(READY);
    expect(worker.posted[1]).toEqual({ kind: 'carve', target: { index: 1, fraction: 0 } });
    client.carve({ index: 2, fraction: 0 });
    client.carve({ index: 3, fraction: 0.5 });
    expect(worker.posted).toHaveLength(2);
    worker.reply(carved(1));
    expect(worker.posted[2]).toEqual({ kind: 'carve', target: { index: 3, fraction: 0.5 } });
    worker.reply(carved(3));
    expect(worker.posted).toHaveLength(3);
    client.carve({ index: 0, fraction: 0 });
    expect(worker.posted).toHaveLength(4);
    expect(heard.map((response) => response.kind)).toEqual(['ready', 'carved', 'carved']);
  });

  it('asks nothing more of a worker with nothing to carve', () => {
    const { worker, client } = start();
    worker.reply({ kind: 'none' });
    client.carve({ index: 1, fraction: 0 });
    expect(worker.posted).toHaveLength(1);
  });

  it('stops the worker and ignores what it sends after', () => {
    const { worker, heard, client } = start();
    client.dispose();
    worker.reply(READY);
    expect(worker.terminated).toBe(true);
    expect(heard).toHaveLength(0);
  });

  it('starts nothing where workers cannot run', () => {
    expect(
      startStockWorker(
        MOVES,
        () => undefined,
        () => null,
      ),
    ).toBeNull();
  });
});
