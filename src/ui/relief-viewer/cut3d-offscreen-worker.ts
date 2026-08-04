/// <reference lib="webworker" />

import {
  createCut3DOffscreenRenderer,
  type Cut3DOffscreenRenderer,
} from './cut3d-offscreen-renderer';
import type {
  Cut3DOffscreenWorkerRequest,
  Cut3DOffscreenWorkerResponse,
} from './cut3d-offscreen-worker-protocol';

type ActiveRenderer = {
  readonly sessionId: number;
  readonly renderer: Cut3DOffscreenRenderer;
};

let active: ActiveRenderer | null = null;
let initializingSessionId: number | null = null;
let pendingResize: Extract<Cut3DOffscreenWorkerRequest, { readonly kind: 'resize' }> | null = null;
let presentedRevision = 0;

self.onmessage = (event: MessageEvent<Cut3DOffscreenWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'init') {
    void initialize(request);
  } else if (request.kind === 'dispose') {
    disposeSession(request.sessionId);
  } else if (request.kind === 'resize') {
    resize(request);
  } else {
    control(request);
  }
};

async function initialize(
  request: Extract<Cut3DOffscreenWorkerRequest, { readonly kind: 'init' }>,
): Promise<void> {
  disposeActive();
  initializingSessionId = request.sessionId;
  pendingResize = null;
  presentedRevision = 0;
  try {
    const renderer = await createCut3DOffscreenRenderer({
      ...request,
      onFailure: (message) => fail(request.sessionId, message),
    });
    if (initializingSessionId !== request.sessionId) {
      renderer.dispose();
      return;
    }
    active = { sessionId: request.sessionId, renderer };
    initializingSessionId = null;
    applyPendingResize(request.sessionId);
    if (active?.sessionId !== request.sessionId) return;
    presented(request.sessionId, 'initial', 0);
    post({ kind: 'ready', sessionId: request.sessionId });
  } catch (error) {
    fail(request.sessionId, error instanceof Error ? error.message : String(error));
  }
}

function resize(request: Extract<Cut3DOffscreenWorkerRequest, { readonly kind: 'resize' }>): void {
  if (active?.sessionId === request.sessionId) {
    const didRender = run(request.sessionId, () =>
      active?.renderer.resize(request.widthPx, request.heightPx, request.pixelRatio),
    );
    if (didRender) presented(request.sessionId, 'resize', request.inputId);
  } else if (initializingSessionId === request.sessionId) {
    pendingResize = request;
  }
}

function control(
  request: Extract<Cut3DOffscreenWorkerRequest, { readonly kind: 'control' }>,
): void {
  if (active?.sessionId !== request.sessionId) return;
  const didRender = run(request.sessionId, () => active?.renderer.control(request.control));
  if (didRender) presented(request.sessionId, 'control', request.inputId);
}

function applyPendingResize(sessionId: number): void {
  const resizeRequest = pendingResize;
  pendingResize = null;
  if (resizeRequest === null || resizeRequest.sessionId !== sessionId) return;
  active?.renderer.resize(resizeRequest.widthPx, resizeRequest.heightPx, resizeRequest.pixelRatio);
  presented(sessionId, 'resize', resizeRequest.inputId);
}

function run(sessionId: number, action: () => void): boolean {
  try {
    action();
    return active?.sessionId === sessionId;
  } catch (error) {
    fail(sessionId, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function presented(
  sessionId: number,
  source: 'initial' | 'control' | 'resize',
  inputId: number,
): void {
  if (active?.sessionId !== sessionId && initializingSessionId !== sessionId) return;
  presentedRevision += 1;
  post({ kind: 'presented', sessionId, revision: presentedRevision, source, inputId });
}

function fail(sessionId: number, message: string): void {
  if (active?.sessionId !== sessionId && initializingSessionId !== sessionId) return;
  disposeSession(sessionId);
  post({ kind: 'error', sessionId, message });
}

function disposeSession(sessionId: number): void {
  if (initializingSessionId === sessionId) initializingSessionId = null;
  if (active?.sessionId === sessionId) disposeActive();
  pendingResize = null;
}

function disposeActive(): void {
  active?.renderer.dispose();
  active = null;
}

function post(response: Cut3DOffscreenWorkerResponse): void {
  self.postMessage(response);
}
