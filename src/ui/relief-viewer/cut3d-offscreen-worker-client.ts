import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { ViewerDialogSceneBuilder, ViewerDialogSceneResult } from './use-viewer-dialog-scene';
import { Cut3DOffscreenSession, type Cut3DWorkerPort } from './cut3d-offscreen-session';
import { scheduleBrowserMicrotask } from './schedule-browser-microtask';

export type Cut3DOffscreenCoordinator = {
  readonly buildScene: ViewerDialogSceneBuilder;
};

export type Cut3DOffscreenCoordinatorDependencies = {
  readonly canCreateWorker: () => boolean;
  readonly createWorker: () => Cut3DWorkerPort;
  readonly scheduleMicrotask: (callback: () => void) => void;
};

const UNSUPPORTED_REASON = 'Background 3D rendering is unavailable in this browser.';

class Cut3DOffscreenRuntime {
  private readonly dependencies: Cut3DOffscreenCoordinatorDependencies;
  private active: Cut3DOffscreenSession | null = null;
  private nextSessionId = 0;

  constructor(dependencies: Cut3DOffscreenCoordinatorDependencies) {
    this.dependencies = dependencies;
  }

  build(
    canvas: HTMLCanvasElement,
    mesh: ReliefSurfaceMeshWithNormals,
    stockThicknessMm: number,
    signal: AbortSignal,
    reportFailure: (reason: string) => void,
  ): Promise<ViewerDialogSceneResult> {
    if (!supportsOffscreen(canvas, this.dependencies)) return unsupported();
    if (this.active?.isCompatible(canvas, mesh, stockThicknessMm) !== true) {
      this.active?.dispose();
      const created = this.createSession(canvas, mesh, stockThicknessMm);
      if (created instanceof Error) {
        return Promise.resolve({ kind: 'no-webgl', reason: created.message });
      }
      this.active = created;
    }
    return this.active?.attach(signal, reportFailure) ?? unsupported();
  }

  private createSession(
    canvas: HTMLCanvasElement,
    mesh: ReliefSurfaceMeshWithNormals,
    stockThicknessMm: number,
  ): Cut3DOffscreenSession | Error {
    try {
      this.nextSessionId += 1;
      let created: Cut3DOffscreenSession | null = null;
      const session = new Cut3DOffscreenSession({
        canvas,
        mesh,
        stockThicknessMm,
        sessionId: this.nextSessionId,
        worker: this.dependencies.createWorker(),
        onUnused: () => {
          if (created !== null) this.disposeIfUnused(created);
        },
        onRetired: () => {
          if (this.active === created) this.active = null;
        },
      });
      created = session;
      return session;
    } catch (error) {
      return error instanceof Error ? error : new Error(UNSUPPORTED_REASON);
    }
  }

  private disposeIfUnused(session: Cut3DOffscreenSession): void {
    this.dependencies.scheduleMicrotask(() => {
      if (this.active === session && session.references === 0) session.dispose();
    });
  }
}

const sharedRuntime = new Cut3DOffscreenRuntime(defaultDependencies());

/** Binds one immutable prepared surface to the shared, one-session render runtime. */
export function createCut3DOffscreenCoordinator(
  mesh: ReliefSurfaceMeshWithNormals,
  stockThicknessMm: number,
  dependencies?: Cut3DOffscreenCoordinatorDependencies,
): Cut3DOffscreenCoordinator {
  const runtime =
    dependencies === undefined ? sharedRuntime : new Cut3DOffscreenRuntime(dependencies);
  return {
    buildScene: (canvas, signal, reportFailure) =>
      runtime.build(canvas, mesh, stockThicknessMm, signal, reportFailure),
  };
}

function supportsOffscreen(
  canvas: HTMLCanvasElement,
  dependencies: Cut3DOffscreenCoordinatorDependencies,
): boolean {
  return dependencies.canCreateWorker() && typeof canvas.transferControlToOffscreen === 'function';
}

function unsupported(): Promise<ViewerDialogSceneResult> {
  return Promise.resolve({ kind: 'no-webgl', reason: UNSUPPORTED_REASON });
}

function defaultDependencies(): Cut3DOffscreenCoordinatorDependencies {
  return {
    canCreateWorker: () => typeof Worker !== 'undefined',
    createWorker: () =>
      new Worker(new URL('./cut3d-offscreen-worker.ts', import.meta.url), { type: 'module' }),
    scheduleMicrotask: scheduleBrowserMicrotask,
  };
}
