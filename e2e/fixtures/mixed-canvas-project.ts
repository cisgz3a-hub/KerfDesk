import type { Page } from '@playwright/test';

export async function clearCanvasProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const scenePath = '/src/core/scene/index.ts';
    const storePath = '/src/ui/state/store.ts';
    const [sceneModule, storeModule] = await Promise.all([
      import(/* @vite-ignore */ scenePath),
      import(/* @vite-ignore */ storePath),
    ]);
    const scene = sceneModule as unknown as { readonly createProject: () => unknown };
    const store = storeModule as unknown as StoreApi;
    store.useStore.getState().setProject(scene.createProject());
  });
}

export async function installMixedCanvasProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fixturePath = '/src/__fixtures__/mixed-canvas-compilation-project.ts';
    const storePath = '/src/ui/state/store.ts';
    const canvasViewPath = '/src/ui/state/canvas-view-store.ts';
    const [fixtureModule, storeModule, canvasViewModule] = await Promise.all([
      import(/* @vite-ignore */ fixturePath),
      import(/* @vite-ignore */ storePath),
      import(/* @vite-ignore */ canvasViewPath),
    ]);
    const fixture = fixtureModule as unknown as {
      readonly mixedCanvasCompilationProject: () => unknown;
    };
    const store = storeModule as unknown as StoreApi;
    const canvasView = canvasViewModule as unknown as CanvasViewApi;
    canvasView.useCanvasViewStore.getState().setShowGcode(false);
    store.useStore.getState().setProject(fixture.mixedCanvasCompilationProject());
  });
}

export async function showGcodeCanvas(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/ui/state/canvas-view-store.ts';
    const loaded: unknown = await import(/* @vite-ignore */ modulePath);
    const canvasView = loaded as CanvasViewApi;
    canvasView.useCanvasViewStore.getState().setShowGcode(true);
  });
}

/** Waits through a cheap DOM predicate so responsiveness probes measure the app,
 * not Playwright's injected accessibility-tree traversal. Semantic assertions
 * still run after the measured phase. */
export async function waitForGcodeCanvasReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const refresh = document.querySelector<HTMLButtonElement>(
        'button[title="Recompile this project\'s G-code"]',
      );
      const playback = document.querySelector<HTMLElement>('[aria-label="Playback"]');
      const scene = document.querySelector<HTMLElement>('[data-viewer-state="ready"]');
      return (
        refresh?.disabled === false &&
        playback !== null &&
        playback.offsetParent !== null &&
        scene !== null
      );
    },
    undefined,
    { timeout },
  );
}

interface StoreApi {
  readonly useStore: {
    readonly getState: () => { readonly setProject: (project: unknown) => unknown };
  };
}

interface CanvasViewApi {
  readonly useCanvasViewStore: {
    readonly getState: () => { readonly setShowGcode: (show: boolean) => void };
  };
}
