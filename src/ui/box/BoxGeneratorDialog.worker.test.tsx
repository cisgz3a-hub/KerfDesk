import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBox, type BoxPanel, type BoxSpec } from '../../core/box';
import { BoxGeneratorDialog } from './BoxGeneratorDialog';
import { BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD } from './box-preview-responsiveness';
import type {
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';
import * as boxGenerationRuntime from './box-generation-worker-runtime';

const DEFAULT_SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 0,
  dividersYCount: 0,
};

const SYNCHRONOUS_FALLBACK_WARNING =
  'Background generation was unavailable, so this preview was generated synchronously. Complex designs may temporarily make the app unresponsive.';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<BoxGenerationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: BoxGenerationWorkerRequest[] = [];
  isTerminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: BoxGenerationWorkerRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  respond(response: BoxGenerationWorkerResponse = responseFor(this)): void {
    this.onmessage?.({ data: response } as MessageEvent<BoxGenerationWorkerResponse>);
  }
}

class FakePath2D {
  readonly moveTo = vi.fn();
  readonly lineTo = vi.fn();
}

type RenderedDialog = {
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('Path2D', FakePath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('BoxGeneratorDialog background generation', () => {
  it('hands the default preview to a worker instead of completing geometry during render', async () => {
    const rendered = await renderDialog();
    try {
      expect(FakeWorker.instances).toHaveLength(1);
      expect(currentWorker().posted[0]?.spec.widthMm).toBe(60);
      expect(rendered.host.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(rendered.host.textContent).toContain('Cancel preview generation');
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      await unmount(rendered);
    }
  });

  it('enables Generate only after matching worker geometry is ready', async () => {
    const rendered = await renderDialog();
    try {
      await respond(currentWorker());
      expect(generateButton(rendered.host).disabled).toBe(false);
      await click(generateButton(rendered.host));
      const request = currentWorker().posted[0];
      if (request === undefined) throw new Error('request missing');
      const direct = generateBox(request.spec);
      expect(direct.kind).toBe('generated');
      expect(rendered.onGenerate).toHaveBeenCalledWith(
        direct.kind === 'generated' ? direct.panels : [],
      );
    } finally {
      await unmount(rendered);
    }
  });

  it('terminates obsolete work, ignores its late result, and labels cached geometry stale', async () => {
    const rendered = await renderDialog();
    try {
      const first = currentWorker();
      await respond(first);
      await setInput(rendered.host, 'Width', '70');
      const second = currentWorker();
      const staleHandler = second.onmessage;
      await setInput(rendered.host, 'Width', '80');
      const third = currentWorker();
      expect(second.isTerminated).toBe(true);
      expect(third).not.toBe(second);
      expect(third.posted[0]?.id).toBeGreaterThan(second.posted[0]?.id ?? 0);
      expect(rendered.host.textContent).toContain(
        'Showing last generated preview while current values generate',
      );
      expect(generateButton(rendered.host).disabled).toBe(true);

      await act(async () => staleHandler?.({ data: responseFor(second) } as MessageEvent));
      expect(generateButton(rendered.host).disabled).toBe(true);

      await respond(third);
      expect(generateButton(rendered.host).disabled).toBe(false);
      expect(rendered.host.textContent).toContain('Current · Outer 86 × 46 × 36 mm');
    } finally {
      await unmount(rendered);
    }
  });

  it('cancels active preview work and retries on a fresh worker', async () => {
    const rendered = await renderDialog();
    try {
      const first = currentWorker();
      await click(button(rendered.host, 'Cancel preview generation'));
      expect(first.isTerminated).toBe(true);
      expect(rendered.host.textContent).toContain('Preview generation cancelled');
      expect(rendered.host.textContent).not.toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(generateButton(rendered.host).disabled).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);

      await click(button(rendered.host, 'Retry preview generation'));
      expect(FakeWorker.instances).toHaveLength(2);
      expect(currentWorker().posted[0]?.id).toBeGreaterThan(first.posted[0]?.id ?? 0);
    } finally {
      await unmount(rendered);
    }
  });

  it('cancels active work when the current draft becomes incomplete', async () => {
    const rendered = await renderDialog();
    try {
      const worker = currentWorker();
      await setInput(rendered.host, 'Width', '');
      expect(worker.isTerminated).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(rendered.host.textContent).toContain('Width: Enter a value');
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      await unmount(rendered);
    }
  });

  it('cancels active work when the current draft becomes invalid', async () => {
    const rendered = await renderDialog();
    try {
      const worker = currentWorker();
      await setInput(rendered.host, 'Width', '0');
      expect(worker.isTerminated).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(rendered.host.textContent).toContain('Width: Must be greater than 0');
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      await unmount(rendered);
    }
  });

  it.each(['Cancel', 'Escape'] as const)(
    'terminates pending work before dialog %s closes without insertion',
    async (action) => {
      const rendered = await renderDialog();
      const worker = currentWorker();
      if (action === 'Cancel') {
        await click(button(rendered.host, 'Cancel'));
      } else {
        await act(async () =>
          rendered.host
            .querySelector('[role="dialog"]')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
      }
      expect(worker.isTerminated).toBe(true);
      expect(rendered.onCancel).toHaveBeenCalledTimes(1);
      expect(rendered.onGenerate).not.toHaveBeenCalled();
      await unmount(rendered);
    },
  );

  it('terminates pending work on unmount without firing dialog callbacks', async () => {
    const rendered = await renderDialog();
    const worker = currentWorker();
    await unmount(rendered);
    expect(worker.isTerminated).toBe(true);
    expect(rendered.onCancel).not.toHaveBeenCalled();
    expect(rendered.onGenerate).not.toHaveBeenCalled();
  });

  it('surfaces message failures as retryable instead of falling back on the main thread', async () => {
    const rendered = await renderDialog();
    try {
      await act(async () => currentWorker().onmessageerror?.());
      expect(rendered.host.textContent).toContain('response could not be read');
      expect(rendered.host.textContent).toContain('Retry preview generation');
      expect(rendered.host.textContent).not.toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      await unmount(rendered);
    }
  });

  it('falls back synchronously when Worker support is unavailable and discloses responsiveness risk', async () => {
    vi.unstubAllGlobals();
    const rendered = await renderDialog();
    try {
      expect(rendered.host.textContent).toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(rendered.host.textContent).not.toContain('Retry preview generation');
      expect(generateButton(rendered.host).disabled).toBe(false);
      await click(generateButton(rendered.host));
      const direct = generateBox(DEFAULT_SPEC);
      expect(direct.kind).toBe('generated');
      expect(rendered.onGenerate).toHaveBeenCalledWith(
        direct.kind === 'generated' ? direct.panels : [],
      );
    } finally {
      await unmount(rendered);
    }
  });

  it('falls back synchronously when the module worker cannot be constructed', async () => {
    function BrokenWorker(): never {
      throw new Error('worker chunk missing');
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const rendered = await renderDialog();
    try {
      expect(rendered.host.textContent).toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(generateButton(rendered.host).disabled).toBe(false);
    } finally {
      await unmount(rendered);
    }
  });

  it('runs a construction fallback only once during StrictMode effect replay', async () => {
    vi.unstubAllGlobals();
    const runtimeSpy = vi.spyOn(boxGenerationRuntime, 'runBoxGenerationRequest');
    const rendered = await renderDialog(true);
    try {
      expect(rendered.host.textContent).toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(runtimeSpy).toHaveBeenCalledTimes(1);
    } finally {
      runtimeSpy.mockRestore();
      await unmount(rendered);
    }
  });

  it('discloses responsiveness risk when a synchronous fallback returns an error', async () => {
    vi.unstubAllGlobals();
    const runtimeSpy = vi
      .spyOn(boxGenerationRuntime, 'runBoxGenerationRequest')
      .mockReturnValueOnce({
        kind: 'result',
        id: 1,
        result: { kind: 'error', message: 'fallback geometry failed' },
        metrics: null,
      });
    const rendered = await renderDialog();
    try {
      expect(rendered.host.textContent).toContain('fallback geometry failed');
      expect(rendered.host.textContent).toContain(
        'Background generation was unavailable, so this attempt ran synchronously.',
      );
      expect(rendered.host.textContent).toContain(
        'Retrying complex designs may temporarily make the app unresponsive.',
      );
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      runtimeSpy.mockRestore();
      await unmount(rendered);
    }
  });

  it('does not replay synchronously after a constructed worker fails to start its request', async () => {
    class ThrowingPostWorker extends FakeWorker {
      override postMessage(): void {
        throw new Error('clone failed');
      }
    }
    vi.stubGlobal('Worker', ThrowingPostWorker);
    const rendered = await renderDialog();
    try {
      expect(FakeWorker.instances).toHaveLength(1);
      expect(rendered.host.textContent).toContain('clone failed');
      expect(rendered.host.textContent).toContain('Retry preview generation');
      expect(rendered.host.textContent).not.toContain(SYNCHRONOUS_FALLBACK_WARNING);
      expect(generateButton(rendered.host).disabled).toBe(true);
    } finally {
      await unmount(rendered);
    }
  });

  it('keeps flat and assembled previews visible above the advisory point threshold', async () => {
    const rendered = await renderDialog();
    try {
      await setInput(rendered.host, 'Finger width', '3');
      await setInput(rendered.host, 'Width', '5000');
      const worker = currentWorker();
      const response = responseFor(worker);
      if (response.kind !== 'result' || response.metrics === null) {
        throw new Error('generated response missing');
      }
      expect(response.metrics.pointCount).toBeGreaterThan(
        BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD,
      );
      await respond(worker, response);
      expect(rendered.host.textContent).not.toContain('Preview hidden for responsiveness');
      expect(
        rendered.host.querySelector('canvas[aria-label="Generated panel sheet preview"]'),
      ).not.toBeNull();
      await click(button(rendered.host, 'Assembled'));
      expect(
        rendered.host.querySelector('canvas[aria-label="Assembled box preview"]'),
      ).not.toBeNull();
      expect(generateButton(rendered.host).disabled).toBe(false);
      await click(generateButton(rendered.host));
      const result = response.result;
      expect(result.kind).toBe('generated');
      expect(rendered.onGenerate).toHaveBeenCalledWith(
        result.kind === 'generated' ? result.panels : [],
      );
    } finally {
      await unmount(rendered);
    }
  });
});

async function renderDialog(strictMode = false): Promise<RenderedDialog> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onGenerate = vi.fn<(panels: ReadonlyArray<BoxPanel>) => void>();
  const onCancel = vi.fn();
  const dialog = (
    <BoxGeneratorDialog machine={{ kind: 'laser' }} onCancel={onCancel} onGenerate={onGenerate} />
  );
  await act(async () => {
    root.render(strictMode ? <StrictMode>{dialog}</StrictMode> : dialog);
  });
  return { host, root, onGenerate, onCancel };
}

function responseFor(worker: FakeWorker): BoxGenerationWorkerResponse {
  const request = worker.posted[0];
  if (request === undefined) throw new Error('request missing');
  return boxGenerationRuntime.runBoxGenerationRequest(request);
}

async function respond(worker: FakeWorker, response = responseFor(worker)): Promise<void> {
  await act(async () => worker.respond(response));
}

async function setInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  element.value = value;
  await act(async () => Simulate.change(element));
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return match;
}

function generateButton(host: HTMLElement): HTMLButtonElement {
  return button(host, 'Generate');
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('worker missing');
  return worker;
}

async function unmount(rendered: RenderedDialog): Promise<void> {
  await act(async () => rendered.root.unmount());
}
