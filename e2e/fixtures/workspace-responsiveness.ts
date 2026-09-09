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
  const points = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const candidates = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75].flatMap((fy) =>
      [0.15, 0.25, 0.35, 0.45, 0.55, 0.75].map((fx) => ({
        x: rect.x + rect.width * fx,
        y: rect.y + rect.height * fy,
      })),
    );
    // Compact viewports place Preview controls over the canvas. Moving over
    // those controls cannot exercise the artwork's pointer/redraw behavior.
    return candidates
      .filter(({ x, y }) => document.elementFromPoint(x, y) === element)
      .slice(0, 12);
  });
  expect(points).toHaveLength(12);
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
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
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
