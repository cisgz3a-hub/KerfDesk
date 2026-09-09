import { expect, type Page } from './kerfdesk-test';

interface HoverObservation {
  redraws: number;
  pointerMoves: number;
  stop: () => void;
}

/** Observe real canvas paints while native pointer events update the cursor. */
export async function checkWorkspaceHover(page: Page): Promise<{
  redraws: number;
  pointerMoves: number;
}> {
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw Error('Workspace canvas has no visible bounds');
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await canvas.evaluate((element) => {
    const target = window as Window & { __workspaceHover?: HoverObservation };
    const original = CanvasRenderingContext2D.prototype.clearRect;
    const observe: HoverObservation = { redraws: 0, pointerMoves: 0, stop: () => undefined };
    const onMove = (): void => {
      observe.pointerMoves++;
    };
    CanvasRenderingContext2D.prototype.clearRect = function (...args): void {
      if (this.canvas === element) observe.redraws++;
      original.apply(this, args);
    };
    element.addEventListener('pointermove', onMove);
    observe.stop = () => {
      CanvasRenderingContext2D.prototype.clearRect = original;
      element.removeEventListener('pointermove', onMove);
    };
    target.__workspaceHover = observe;
  });
  try {
    for (let index = 0; index < 12; index++) {
      await page.mouse.move(
        bounds.x + bounds.width * (0.2 + (index % 6) * 0.1),
        bounds.y + bounds.height * (index < 6 ? 0.35 : 0.65),
      );
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    const result = await page.evaluate(() => {
      const observe = (window as Window & { __workspaceHover?: HoverObservation }).__workspaceHover;
      if (observe === undefined) throw Error('Workspace observation was not installed');
      return { redraws: observe.redraws, pointerMoves: observe.pointerMoves };
    });
    expect(result.pointerMoves).toBe(12);
    expect(result.redraws).toBe(0);
    return result;
  } finally {
    await page.evaluate(() => {
      const target = window as Window & { __workspaceHover?: HoverObservation };
      target.__workspaceHover?.stop();
      delete target.__workspaceHover;
    });
  }
}
