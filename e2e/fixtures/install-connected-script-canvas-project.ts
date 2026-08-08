import type { Page } from '@playwright/test';

const FIXTURE_MODULE_PATH = '/src/__fixtures__/connected-script-canvas-compilation-project.ts';
const FONT_MODULE_PATH = '/src/ui/text/font-loader.ts';
const STORE_MODULE_PATH = '/src/ui/state/store.ts';
const CANVAS_VIEW_MODULE_PATH = '/src/ui/state/canvas-view-store.ts';

/** Loads the connected-script fonts, installs the fixture project, and resets the G-code view. */
export async function installConnectedScriptCanvasProject(page: Page): Promise<void> {
  await page.evaluate(
    async ({ fixturePath, fontPath, storePath, canvasViewPath }) => {
      const [fixtureModule, fontModule, storeModule, canvasViewModule] = await Promise.all([
        import(/* @vite-ignore */ fixturePath),
        import(/* @vite-ignore */ fontPath),
        import(/* @vite-ignore */ storePath),
        import(/* @vite-ignore */ canvasViewPath),
      ]);
      // Runtime Vite path imports lose static types; these minimal structural
      // contracts expose only the fixture members exercised at this boundary.
      const fixture = fixtureModule as unknown as FixtureApi;
      const fonts = fontModule as unknown as FontApi;
      const store = storeModule as unknown as StoreApi;
      const canvasView = canvasViewModule as unknown as CanvasViewApi;
      const project = await fixture.connectedScriptCanvasCompilationProject(fonts.loadFont);
      canvasView.useCanvasViewStore.getState().setShowGcode(false);
      store.useStore.getState().setProject(project);
    },
    {
      fixturePath: FIXTURE_MODULE_PATH,
      fontPath: FONT_MODULE_PATH,
      storePath: STORE_MODULE_PATH,
      canvasViewPath: CANVAS_VIEW_MODULE_PATH,
    },
  );
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
