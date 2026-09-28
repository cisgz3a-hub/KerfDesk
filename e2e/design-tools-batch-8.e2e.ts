import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state/store';

// LightBurn gap batch 8 (ADR-498): the design tools run end to end in the real
// canvas and menus, each as one undo step, with no page errors.

interface ObjectSummary {
  readonly id: string;
  readonly kind: string;
  readonly contours: readonly { readonly closed: boolean; readonly points: number }[];
}

async function sceneSummary(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(moduleUrl)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    const objects = state.project.scene.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      contours:
        'paths' in object
          ? object.paths.flatMap((path) =>
              path.polylines.map((polyline) => ({
                closed: polyline.closed,
                points: polyline.points.length,
              })),
            )
          : [],
    }));
    return { objects: objects as readonly ObjectSummary[], undo: state.undoStack.length };
  });
}

async function canvasBox(page: Page) {
  const box = await page.getByLabel('KerfDesk workspace', { exact: true }).boundingBox();
  if (box === null) throw new Error('Workspace canvas has no box');
  return box;
}

async function drawRectangle(page: Page, from: number, to: number): Promise<void> {
  await page.getByRole('button', { name: 'Draw rectangle' }).click();
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * from, box.y + box.height * from);
  await page.mouse.down({ button: 'left' });
  await page.keyboard.down('Alt'); // place exactly where asked, not on a snap target
  await page.mouse.move(box.x + box.width * to, box.y + box.height * to, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

async function runMenu(page: Page, family: string, command: string): Promise<void> {
  const applicationMenu = page.getByRole('menubar', { name: 'Application menu' });
  await applicationMenu.getByRole('menuitem', { name: family, exact: true }).click();
  await applicationMenu
    .getByRole('menuitem')
    .or(applicationMenu.getByRole('menuitemcheckbox'))
    .filter({ has: page.getByText(command, { exact: true }) })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
});

test('cuts one rectangle with another, then trims an outline back to its crossings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await drawRectangle(page, 0.35, 0.55);
  await drawRectangle(page, 0.45, 0.65);
  const drawn = await sceneSummary(page);
  expect(drawn.objects).toHaveLength(2);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await runMenu(page, 'Tools', 'Cut Shapes');
  const cut = await sceneSummary(page);
  expect(cut.objects.map((object) => object.id).sort()).toEqual(
    [`${drawn.objects[0]?.id}-inside`, `${drawn.objects[0]?.id}-outside`].sort(),
  );
  expect(cut.undo).toBe(drawn.undo + 1);
  await page.keyboard.press('Control+z');
  expect((await sceneSummary(page)).objects).toHaveLength(2);

  await page.keyboard.press('Escape');
  await runMenu(page, 'Tools', 'Trim Shapes');
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const box = await canvasBox(page);
  // The first rectangle's right edge, below where the second's top edge crosses it.
  const x = box.x + box.width * 0.55;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x - 20, y);
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.click(x, y);
  const trimmed = await sceneSummary(page);
  const first = trimmed.objects.find((object) => object.id === drawn.objects[0]?.id);
  expect(first?.contours).toHaveLength(1);
  expect(first?.contours[0]?.closed).toBe(false);
  expect(trimmed.objects.find((object) => object.id === drawn.objects[1]?.id)?.contours).toEqual(
    drawn.objects[1]?.contours,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(errors).toEqual([]);
});

test('warps a rectangle by dragging a corner handle and applies it with Enter', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await drawRectangle(page, 0.4, 0.6);
  const before = await sceneSummary(page);
  await runMenu(page, 'Tools', 'Warp');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
  const box = await canvasBox(page);
  const corner = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  const after = await sceneSummary(page);
  expect(after.undo).toBe(before.undo + 1);
  expect(after.objects[0]?.id).toBe(before.objects[0]?.id);
  expect(after.objects[0]?.kind).not.toBe('shape');
  await page.keyboard.press('Control+z');
  expect((await sceneSummary(page)).objects[0]?.kind).toBe(before.objects[0]?.kind);
  expect(errors).toEqual([]);
});

test('copies artwork along a drawn ellipse and opens the snap settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await drawRectangle(page, 0.48, 0.5);
  await page.getByRole('button', { name: 'Draw ellipse' }).click();
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const before = await sceneSummary(page);
  expect(before.objects).toHaveLength(2);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await runMenu(page, 'Arrange', 'Copy Along Path...');
  const dialog = page.getByRole('dialog', { name: 'Copy Along Path' });
  await expect(dialog.getByRole('status')).toContainText('5 copies');
  await dialog.getByRole('button', { name: 'Copy along path', exact: true }).click();
  const after = await sceneSummary(page);
  expect(after.objects).toHaveLength(7);
  expect(after.undo).toBe(before.undo + 1);

  await page.getByRole('button', { name: 'Snap settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Intersections' })).toBeVisible();
  expect(errors).toEqual([]);
});
