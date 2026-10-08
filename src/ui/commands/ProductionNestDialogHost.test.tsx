import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickNestDialogHost } from './QuickNestDialogHost';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  productionDefinitionFixture,
  productionProjectFixture,
} from '../state/production-nest.test-fixture';
import { planProductionNest } from '../../core/nesting/production-nest-plan';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
class ProductionWorker {
  static last: ProductionWorker;
  input: NestingWorkerRequest | null = null;
  onmessage: ((event: MessageEvent<NestingWorkerResponse>) => void) | null = null;
  terminate = vi.fn();
  constructor() {
    ProductionWorker.last = this;
  }
  postMessage(input: NestingWorkerRequest): void {
    this.input = input;
  }
  send(data: NestingWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<NestingWorkerResponse>);
  }
}
let root: Root | null = null,
  host: HTMLDivElement | null = null;
beforeEach(() => {
  resetStore();
  vi.stubGlobal('Worker', ProductionWorker);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});
async function render(): Promise<ReturnType<typeof vi.fn>> {
  const close = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<QuickNestDialogHost onClose={close} />));
  await click('Quantity production across sheets');
  return close;
}
async function click(text: string): Promise<void> {
  const button = Array.from(host!.querySelectorAll('button')).find(
    (button) => button.textContent === text,
  );
  if (button === undefined) throw new Error('Missing button: ' + text);
  await act(async () => Simulate.click(button));
}
async function calculate(): Promise<ProductionWorker> {
  await click('Calculate quantity layout');
  const worker = ProductionWorker.last;
  if (worker.input?.kind !== 'production-search') throw new Error('Missing quantity request');
  const best = planProductionNest(worker.input.input);
  await act(async () =>
    worker.send({ kind: 'production-progress', progress: { attempted: 1, total: 1, best } }),
  );
  return worker;
}

describe('quantity production operator workflow', () => {
  it('opens from Quick Nest and reviews counts and named sheet previews before one atomic acceptance', async () => {
    const project = {
      ...productionProjectFixture(),
      productionNest: productionDefinitionFixture(),
    };
    useStore.setState({ project, selectedObjectId: 'source' });
    const close = await render();
    const worker = await calculate();
    expect(useStore.getState().project).toBe(project);
    expect(host!.textContent).toContain('2 of 2 requested copies placed. 0 unplaced.');
    expect(host!.querySelectorAll('svg')).toHaveLength(2);
    expect(host!.textContent).toContain('offcut-two');
    expect(host!.textContent).toContain('Executable cut and rapid distances');
    await click('Accept complete quantities');
    expect(useStore.getState().project.scene).toBe(project.scene);
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(2);
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it('leaves calculated copies unapplied on cancellation and suppresses late worker messages', async () => {
    const project = {
      ...productionProjectFixture(),
      productionNest: productionDefinitionFixture(),
    };
    useStore.setState({ project, selectedObjectId: 'source' });
    const close = await render();
    const worker = await calculate();
    await click('Cancel');
    expect(close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await act(async () =>
      worker.send({
        kind: 'production-progress',
        progress: { attempted: 99, total: 99, best: null },
      }),
    );
    expect(useStore.getState().project).toBe(project);
    expect(host!.textContent).not.toContain('99 / 99');
  });
  it('makes unplaced copies explicit and disables acceptance after artwork or setup changes', async () => {
    const definition = productionDefinitionFixture();
    const project = {
      ...productionProjectFixture(),
      productionNest: { ...definition, sheets: definition.sheets.slice(0, 1) },
    };
    useStore.setState({ project, selectedObjectId: 'source' });
    await render();
    await calculate();
    expect(host!.textContent).toContain('1 of 2 requested copies placed. 1 unplaced.');
    const accept = Array.from(host!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Accept partial production with unplaced copies',
    )!;
    expect(accept.disabled).toBe(false);
    await act(async () =>
      useStore.setState({
        project: { ...project, workspace: { ...project.workspace, width: 99 } },
      }),
    );
    expect(accept.disabled).toBe(true);
    expect(host!.textContent).toContain('Calculate a fresh quantity draft');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
