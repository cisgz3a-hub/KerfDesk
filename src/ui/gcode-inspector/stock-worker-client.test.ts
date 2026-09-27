import { describe, expect, it } from 'vitest';
import type { StockMoves } from './stock-carving';
import { startStockWorker } from './stock-worker-client';
import type {
  StockViewResponse,
  StockWorkerRequest,
  StockWorkerResponse,
} from './stock-worker-protocol';

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
  design: null,
};

function carved(index: number): StockWorkerResponse {
  return {
    kind: 'carved',
    target: { index, fraction: 0 },
    firstRow: 0,
    depth: new Float32Array(0),
    comparison: null,
  };
}

function start() {
  const worker = new StubWorker();
  const heard: StockViewResponse[] = [];
  const client = startStockWorker(
    { moves: MOVES },
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
    expect(worker.posted[1]).toEqual({
      kind: 'carve',
      target: { index: 1, fraction: 0 },
      toleranceMm: null,
    });
    client.carve({ index: 2, fraction: 0 });
    client.carve({ index: 3, fraction: 0.5 });
    expect(worker.posted).toHaveLength(2);
    worker.reply(carved(1));
    expect(worker.posted[2]).toEqual({
      kind: 'carve',
      target: { index: 3, fraction: 0.5 },
      toleranceMm: null,
    });
    worker.reply(carved(3));
    expect(worker.posted).toHaveLength(3);
    client.carve({ index: 0, fraction: 0 });
    expect(worker.posted).toHaveLength(4);
    expect(heard.map((response) => response.kind)).toEqual(['ready', 'carved', 'carved']);
  });

  it('sends the design with the moves, and compares where playback is when asked', () => {
    const worker = new StubWorker();
    const design = { thicknessMm: 12, reliefs: [] };
    const client = startStockWorker(
      { moves: MOVES, design },
      () => undefined,
      () => worker,
    );
    if (client === null) throw new Error('no client');
    const request = worker.posted[0];
    expect(request?.kind === 'start' ? request.design : null).toEqual(design);
    worker.reply(READY);
    client.carve({ index: 1, fraction: 0.25 });
    worker.reply(carved(1));
    client.compare(0.1);
    expect(worker.posted.at(-1)).toEqual({
      kind: 'carve',
      target: { index: 1, fraction: 0.25 },
      toleranceMm: 0.1,
    });
    worker.reply(carved(1));
    client.carve({ index: 2, fraction: 0 });
    expect(worker.posted.at(-1)).toMatchObject({ toleranceMm: 0.1 });
    worker.reply(carved(2));
    client.compare(null);
    expect(worker.posted.at(-1)).toMatchObject({ target: { index: 2 }, toleranceMm: null });
  });

  it('asks nothing more of a worker with nothing to carve', async () => {
    const { worker, client } = start();
    worker.reply({ kind: 'none' });
    client.carve({ index: 1, fraction: 0 });
    expect(worker.posted).toHaveLength(1);
    await expect(client.stl()).resolves.toBeNull();
  });

  it('saves the stock as carved to the last carve asked before it', async () => {
    const { worker, heard, client } = start();
    worker.reply(READY);
    client.carve({ index: 1, fraction: 0 });
    const saved = client.stl();
    client.carve({ index: 2, fraction: 0 });
    worker.reply(carved(1));
    expect(worker.posted.at(-1)).toMatchObject({ kind: 'carve', target: { index: 2 } });
    worker.reply(carved(2));
    expect(worker.posted.at(-1)).toEqual({ kind: 'stl' });
    const stl = { bytes: new ArrayBuffer(84), triangles: 0 };
    worker.reply({ kind: 'stl', stl });
    await expect(saved).resolves.toBe(stl);
    // The view hears only the carving.
    expect(heard.map((response) => response.kind)).toEqual(['ready', 'carved', 'carved']);
  });

  it('gives no STL once the worker is stopped', async () => {
    const { worker, client } = start();
    worker.reply(READY);
    const saved = client.stl();
    client.dispose();
    await expect(saved).resolves.toBeNull();
    await expect(client.stl()).resolves.toBeNull();
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
        { moves: MOVES },
        () => undefined,
        () => null,
      ),
    ).toBeNull();
  });
});
