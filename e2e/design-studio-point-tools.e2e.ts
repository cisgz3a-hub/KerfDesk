import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Design Studio' })).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('draws Polyline and Arc through native mouse events with one-step undo', async ({ page }) => {
  const canvas = page.getByLabel('Design canvas, 0 entities');
  const points = await canvasPoints(canvas);

  await page.getByRole('button', { name: 'Polyline', exact: true }).click();
  await page.mouse.click(points.left.x, points.left.y);
  await page.mouse.click(points.top.x, points.top.y);
  await page.mouse.dblclick(points.right.x, points.right.y);

  await expect(page.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => persistedFirstEntityShape(page))
    .toEqual({ kind: 'path', closed: false, pointCount: 3 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Design canvas, 0 entities')).toBeVisible();

  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  await page.mouse.click(points.left.x, points.left.y);
  await expect(page.getByLabel('Design Studio status')).toContainText(
    'Centre set. Click the arc start point.',
  );
  await page.mouse.click(points.top.x, points.top.y);
  await expect(page.getByLabel('Design Studio status')).toContainText(
    'Start set. Click the arc end point',
  );
  await page.mouse.click(points.right.x, points.right.y);

  await expect(page.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Design canvas, 0 entities')).toBeVisible();
});

test('keeps native right and middle drags from adding point-tool geometry', async ({ page }) => {
  const canvas = page.getByLabel('Design canvas, 0 entities');
  const points = await canvasPoints(canvas);
  await page.getByRole('button', { name: 'Polyline', exact: true }).click();

  await dragWithButton(page, points.left, points.right, 'right');
  await dragWithButton(page, points.top, points.left, 'middle');

  await expect(page.getByLabel('Design canvas, 0 entities')).toBeVisible();
  await expect(page.getByLabel('Design Studio status')).toContainText('Click each corner.');
});

async function canvasPoints(canvas: Locator): Promise<{
  readonly left: { readonly x: number; readonly y: number };
  readonly top: { readonly x: number; readonly y: number };
  readonly right: { readonly x: number; readonly y: number };
}> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Design canvas has no browser bounds');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return {
    left: { x: centerX - 70, y: centerY + 45 },
    top: { x: centerX, y: centerY - 55 },
    right: { x: centerX + 70, y: centerY + 45 },
  };
}

async function dragWithButton(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  button: 'middle' | 'right',
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up({ button });
}

async function persistedFirstEntityShape(page: Page): Promise<{
  readonly kind: unknown;
  readonly closed: unknown;
  readonly pointCount: number | null;
} | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('laserforge.design-studio-session.v1');
    if (raw === null) return null;
    const stored = JSON.parse(raw) as {
      readonly sketch?: { readonly entities?: readonly Record<string, unknown>[] };
    };
    const entity = stored.sketch?.entities?.[0];
    if (entity === undefined) return null;
    return {
      kind: entity.kind,
      closed: entity.closed,
      pointCount: Array.isArray(entity.points) ? entity.points.length : null,
    };
  });
}
