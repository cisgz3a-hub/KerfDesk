import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

// ADR-634: a safety notice floats over the canvas. Raising or acknowledging it
// must not move the top bar, the canvas or the rails. It stays inside the
// canvas, or spans the window from the canvas top when the canvas is narrower
// than the card, and never covers Frame job or Start.
for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 640, height: 450 },
  { width: 360, height: 640 },
]) {
  test(`a failed controller write floats over the canvas at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
    const setupHint = page.getByRole('button', { name: 'Not now', exact: true });
    if (await setupHint.isVisible()) await setupHint.click();
    const regions = [
      page.locator('.lf-workspace-topbar'),
      page.locator('[data-toast-workspace]'),
      page.locator('.lf-workspace-panels'),
    ];
    const before = await boxes(regions);

    await raiseWriteFailed(page);
    const notice = page.getByRole('alert').filter({ hasText: 'Controller write failed' });
    await expect(notice).toBeVisible();
    await expect.poll(() => boxes(regions)).toEqual(before);
    const bounds = await notice.boundingBox();
    const canvas = before[1];
    if (bounds === null || canvas == null) throw new Error('Notice and canvas must be visible');
    expect(bounds.y).toBeGreaterThanOrEqual(canvas.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    if (canvas.width >= 444) {
      expect(bounds.x).toBeGreaterThanOrEqual(canvas.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    } else {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.width).toBeGreaterThanOrEqual(viewport.width - 25);
    }
    for (const name of ['Frame job', 'Start']) {
      for (const control of await page.getByRole('button', { name, exact: true }).all()) {
        const box = await control.boundingBox();
        if (box !== null) expect(overlaps(bounds, box), name).toBe(false);
      }
    }
    await page.screenshot({ path: test.info().outputPath('safety-notice-toast.png') });

    await notice.getByRole('button', { name: 'I made the machine safe', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => boxes(regions)).toEqual(before);
  });
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function boxes(regions: readonly Locator[]) {
  return Promise.all(regions.map((region) => region.first().boundingBox()));
}

async function raiseWriteFailed(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ modulePath)) as {
      useLaserStore: { setState: (state: Record<string, unknown>) => void };
    };
    useLaserStore.setState({
      safetyNotice: { kind: 'write-failed', action: 'jog', message: 'Jog write failed.' },
    });
  });
}
