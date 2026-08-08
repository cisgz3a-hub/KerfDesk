import type { Page } from '@playwright/test';

/** Installs the real script fixture into the browser store with G-code hidden. */
export async function installConnectedScriptCompilationProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fixturePath = '/src/__fixtures__/connected-script-compilation-project.ts';
    const fontLoaderPath = '/src/ui/text/font-loader.ts';
    const storePath = '/src/ui/state/store.ts';
    const canvasViewPath = '/src/ui/state/canvas-view-store.ts';
    const [fixtureModule, fontLoaderModule, storeModule, canvasViewModule] = await Promise.all([
      import(/* @vite-ignore */ fixturePath),
      import(/* @vite-ignore */ fontLoaderPath),
      import(/* @vite-ignore */ storePath),
      import(/* @vite-ignore */ canvasViewPath),
    ]);
    const fixture = fixtureModule as unknown as ConnectedScriptFixtureApi;
    const fontLoader = fontLoaderModule as unknown as FontLoaderApi;
    const store = storeModule as unknown as StoreApi;
    const canvasView = canvasViewModule as unknown as CanvasViewApi;
    const fontBuffer = await fontLoader.loadFont('dancing-script-regular');
    const project = await fixture.connectedScriptCompilationProject(fontBuffer);

    canvasView.useCanvasViewStore.getState().setShowGcode(false);
    store.useStore.getState().setProject(project);
  });
}

interface ConnectedScriptFixtureApi {
  readonly connectedScriptCompilationProject: (fontBuffer: ArrayBuffer) => Promise<unknown>;
}

interface FontLoaderApi {
  readonly loadFont: (key: string) => Promise<ArrayBuffer>;
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
