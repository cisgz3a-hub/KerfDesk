import type { Page } from '@playwright/test';

export async function installConnectedScriptCanvasProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fixturePath = '/src/__fixtures__/connected-script-canvas-compilation-project.ts';
    const fontPath = '/src/ui/text/font-loader.ts';
    const storePath = '/src/ui/state/store.ts';
    const canvasViewPath = '/src/ui/state/canvas-view-store.ts';
    const [fixtureModule, fontModule, storeModule, canvasViewModule] = await Promise.all([
      import(/* @vite-ignore */ fixturePath),
      import(/* @vite-ignore */ fontPath),
      import(/* @vite-ignore */ storePath),
      import(/* @vite-ignore */ canvasViewPath),
    ]);
    const fixture = fixtureModule as unknown as FixtureApi;
    const fonts = fontModule as unknown as FontApi;
    const store = storeModule as unknown as StoreApi;
    const canvasView = canvasViewModule as unknown as CanvasViewApi;
    const project = await fixture.connectedScriptCanvasCompilationProject(fonts.loadFont);
    canvasView.useCanvasViewStore.getState().setShowGcode(false);
    store.useStore.getState().setProject(project);
  });
}

interface FixtureApi {
  readonly connectedScriptCanvasCompilationProject: (
    loadFont: (fontKey: string) => Promise<ArrayBuffer>,
  ) => Promise<unknown>;
}

interface FontApi {
  readonly loadFont: (fontKey: string) => Promise<ArrayBuffer>;
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
