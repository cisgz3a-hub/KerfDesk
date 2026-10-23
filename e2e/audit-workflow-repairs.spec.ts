import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { SceneObject } from '../src/core/scene';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
});

test('Snap settings supports native Tab traversal and Escape returns to its opener', async ({
  page,
}) => {
  const opener = page.getByRole('button', { name: 'Snap settings', exact: true });
  await opener.click();
  for (const name of [
    'Nodes',
    'Midpoints',
    'Centres',
    'Intersections',
    'Grid',
    'Alignment guides',
    'Snap grid spacing in millimetres',
    'Snap distance in screen pixels',
  ]) {
    await expect(page.getByLabel(name, { exact: true })).toBeFocused();
    if (name !== 'Snap distance in screen pixels') await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Snap settings', exact: true })).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('overflowing notifications scroll over text and scrollbar while short notices pass canvas gestures through', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await notifications(page, true);
  const stack = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(stack).toHaveClass(/lf-toasts--scrollable/);
  const box = await stack.boundingBox();
  if (box === null) throw new Error('Notification stack missing');
  await page.mouse.move(box.x + 60, box.y + 35);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => stack.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await stack.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.mouse.move(box.x + box.width - 2, box.y + 35);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => stack.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('notification-scroll.png') });
  await notifications(page, false);
  await expect(stack).not.toHaveClass(/lf-toasts--scrollable/);
  const message = stack.locator('.lf-toast__message');
  const passedThrough = await message.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return !node
      .closest('.lf-toasts')!
      .contains(document.elementFromPoint(bounds.x + 10, bounds.y + 5));
  });
  expect(passedThrough).toBe(true);
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});

test('a canvas selection change retires the previous width draft, including after Enter', async ({
  page,
  kerfdesk,
}) => {
  await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const load = (path: string) =>
      import(urls.find((url) => new URL(url).pathname === path) ?? path);
    const { useStore } = await load('/src/ui/state/index.ts');
    const { useUiStore } = await load('/src/ui/state/ui-store.ts');
    const drop = new DataTransfer();
    for (const name of ['A.svg', 'B.svg'])
      drop.items.add(
        new File(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="20" height="20" fill="none" stroke="#000000"/></svg>',
          ],
          name,
          { type: 'image/svg+xml' },
        ),
      );
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: drop, bubbles: true, cancelable: true }),
    );
    await new Promise<void>((resolve) => {
      if (useStore.getState().project.scene.objects.length === 2) return resolve();
      const unsubscribe = useStore.subscribe(() => {
        if (useStore.getState().project.scene.objects.length === 2) {
          unsubscribe();
          resolve();
        }
      });
    });
    const state = useStore.getState();
    state.applySelectionTransforms(
      state.project.scene.objects.map((object: SceneObject, index: number) => ({
        id: object.id,
        transform: { ...object.transform, x: 40 + index * 80, y: 90 },
      })),
    );
    state.selectObject(null);
    useUiStore.getState().setView(1, 0, 0);
    useUiStore.getState().setSelectionAnchor('nw');
  });
  const width = page.getByLabel('Selection width', { exact: true });
  for (const enterFirst of [false, true]) {
    await clickArtwork(page, 0);
    await expect(width).toHaveValue('20');
    await width.fill('40');
    if (enterFirst) await width.press('Enter');
    await clickArtwork(page, 1);
    await expect(width).toHaveValue('20');
    const widths = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => new URL(entry).pathname === '/src/ui/state/index.ts')!;
      const { useStore } = await import(url);
      return useStore
        .getState()
        .project.scene.objects.map(
          (object: SceneObject) =>
            (object.bounds.maxX - object.bounds.minX) * object.transform.scaleX,
        );
    });
    expect(widths).toEqual([enterFirst ? 40 : 20, 20]);
  }
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});

async function notifications(page: Page, long: boolean): Promise<void> {
  await page.evaluate(async (overflow) => {
    const path = '/src/ui/state/toast-store.ts';
    const url =
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => new URL(entry).pathname === path) ?? path;
    const { useToastStore } = await import(url);
    useToastStore.setState({
      toasts: overflow
        ? [1, 2, 3].map((id) => ({
            id: `long-${id}`,
            message: `${id}: ${'Long import detail requiring normal mouse scrolling. '.repeat(14)}`,
            variant: 'warning',
          }))
        : [{ id: 'short', message: 'Short notice.', variant: 'info' }],
    });
  }, long);
}

async function clickArtwork(page: Page, index: number): Promise<void> {
  const point = await page.evaluate(async (objectIndex) => {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const load = (path: string) =>
      import(urls.find((url) => new URL(url).pathname === path) ?? path);
    const { useStore } = await load('/src/ui/state/index.ts');
    const { useUiStore } = await load('/src/ui/state/ui-store.ts');
    const { computeView } = await load('/src/ui/workspace/view-transform.ts');
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="KerfDesk workspace"]',
    )!;
    const state = useStore.getState();
    const object = state.project.scene.objects[objectIndex];
    const view = computeView(
      canvas.width,
      canvas.height,
      state.project.device.bedWidth,
      state.project.device.bedHeight,
      useUiStore.getState(),
    );
    const bounds = canvas.getBoundingClientRect();
    return {
      x:
        bounds.left +
        ((view.offsetX + (object.transform.x + 10) * view.scale) * bounds.width) / canvas.width,
      y:
        bounds.top +
        ((view.offsetY + object.transform.y * view.scale) * bounds.height) / canvas.height,
    };
  }, index);
  await page.mouse.click(point.x, point.y);
}
