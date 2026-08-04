import { vi } from 'vitest';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { Cut3DWorkerPort } from './cut3d-offscreen-session';
import type {
  Cut3DOffscreenWorkerRequest,
  Cut3DOffscreenWorkerResponse,
} from './cut3d-offscreen-worker-protocol';

export const MESH: ReliefSurfaceMeshWithNormals = {
  positions: new Float32Array([0, 0, -1, 1, 0, -1, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  widthMm: 1,
  heightMm: 1,
};

export class FakeWorker extends EventTarget implements Cut3DWorkerPort {
  onerror: Worker['onerror'] = null;
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  readonly requests: Cut3DOffscreenWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly terminate = vi.fn();

  postMessage(
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ): void {
    // FakeWorker records the same protocol values that the production port receives.
    this.requests.push(message as Cut3DOffscreenWorkerRequest);
    this.transfers.push(Array.isArray(transferOrOptions) ? transferOrOptions : []);
  }

  emit(response: Cut3DOffscreenWorkerResponse): void {
    this.onmessage?.call(this, new MessageEvent('message', { data: response }));
  }

  emitUnknown(response: unknown): void {
    this.onmessage?.call(this, new MessageEvent('message', { data: response }));
  }

  error(): void {
    this.onerror?.call(this, new ErrorEvent('error'));
  }
}

export function dependencies(worker: FakeWorker) {
  return {
    canCreateWorker: () => true,
    createWorker: () => worker,
    scheduleMicrotask: queueMicrotask,
  };
}

export function transferableCanvas(transfer: () => OffscreenCanvas): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'transferControlToOffscreen', {
    configurable: true,
    value: transfer,
  });
  document.body.appendChild(canvas);
  return canvas;
}

export function offscreen(): OffscreenCanvas {
  // The client only transfers this opaque object; the render worker owns its API.
  return {} as OffscreenCanvas;
}

export function emitReady(worker: FakeWorker): void {
  worker.emit({ kind: 'presented', sessionId: 1, revision: 1, source: 'initial', inputId: 0 });
  worker.emit({ kind: 'ready', sessionId: 1 });
}

export function drain(tasks: Array<() => void>): void {
  for (const task of tasks.splice(0)) task();
}

export function requestOfKind<K extends Cut3DOffscreenWorkerRequest['kind']>(
  worker: FakeWorker,
  kind: K,
): Extract<Cut3DOffscreenWorkerRequest, { readonly kind: K }> {
  const request = worker.requests.find((candidate) => candidate.kind === kind);
  if (request === undefined) throw new Error(`Missing ${kind} request`);
  // The runtime predicate above correlates K with the discriminated request union.
  return request as Extract<Cut3DOffscreenWorkerRequest, { readonly kind: K }>;
}

export function dispatchPointer(
  canvas: HTMLCanvasElement,
  type: string,
  values: {
    readonly button: number;
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  canvas.dispatchEvent(event);
}
