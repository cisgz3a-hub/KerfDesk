import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { Viewer3DCameraControl } from './viewer3d-keyboard-controls';

export type Cut3DOffscreenControl = Viewer3DCameraControl;

export type Cut3DOffscreenWorkerRequest =
  | {
      readonly kind: 'init';
      readonly sessionId: number;
      readonly canvas: OffscreenCanvas;
      readonly mesh: ReliefSurfaceMeshWithNormals;
      readonly stockThicknessMm: number;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly pixelRatio: number;
    }
  | {
      readonly kind: 'control';
      readonly sessionId: number;
      readonly inputId: number;
      readonly control: Cut3DOffscreenControl;
    }
  | {
      readonly kind: 'resize';
      readonly sessionId: number;
      readonly inputId: number;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly pixelRatio: number;
    }
  | { readonly kind: 'dispose'; readonly sessionId: number };

export type Cut3DOffscreenWorkerResponse =
  | { readonly kind: 'ready'; readonly sessionId: number }
  | {
      readonly kind: 'presented';
      readonly sessionId: number;
      readonly revision: number;
      readonly source: 'initial' | 'control' | 'resize';
      readonly inputId: number;
    }
  | { readonly kind: 'error'; readonly sessionId: number; readonly message: string };

type WorkerResponseCandidate = Record<string, unknown> & {
  readonly kind: unknown;
  readonly sessionId: number;
};

export function isCut3DOffscreenWorkerResponse(
  value: unknown,
): value is Cut3DOffscreenWorkerResponse {
  if (!isWorkerResponseCandidate(value)) return false;
  return isReadyResponse(value) || isErrorResponse(value) || isPresentedResponse(value);
}

function isWorkerResponseCandidate(value: unknown): value is WorkerResponseCandidate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'sessionId' in value &&
    isPositiveSafeInteger(value.sessionId)
  );
}

function isReadyResponse(
  value: WorkerResponseCandidate,
): value is Extract<Cut3DOffscreenWorkerResponse, { readonly kind: 'ready' }> {
  return value.kind === 'ready';
}

function isErrorResponse(
  value: WorkerResponseCandidate,
): value is Extract<Cut3DOffscreenWorkerResponse, { readonly kind: 'error' }> {
  return value.kind === 'error' && typeof value.message === 'string';
}

function isPresentedResponse(
  value: WorkerResponseCandidate,
): value is Extract<Cut3DOffscreenWorkerResponse, { readonly kind: 'presented' }> {
  return (
    value.kind === 'presented' &&
    isPositiveSafeInteger(value.revision) &&
    isNonNegativeSafeInteger(value.inputId) &&
    (value.source === 'initial' || value.source === 'control' || value.source === 'resize')
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
