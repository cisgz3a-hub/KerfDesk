import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
  { width: 640, height: 450 },
]) {
  test(`workspace More keeps readable, reachable rows at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/');
    const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
    await expect(canvas).toBeVisible();
    await page
      .getByRole('status', { name: 'Machine not set up', exact: true })
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await seedMenuScene(page);
    const point = await squareEdgeScreen(page);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Workspace quick actions', exact: true });
    await expect(menu).toBeVisible();
    const primary = menu.locator(':scope > button');
    const normalHeights = await primary.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    const moreButton = menu.getByRole('menuitem', { name: 'More', exact: true });
    await moreButton.click();
    const more = page.getByRole('menu', { name: 'More workspace quick actions', exact: true });
    await expect(more).toBeVisible();
    const screenshot = testInfo.outputPath('expanded-menu.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('Expanded workspace menu', {
      path: screenshot,
      contentType: 'image/png',
    });

    const expandedHeights = await primary.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(expandedHeights).toHaveLength(normalHeights.length);
    for (let index = 0; index < normalHeights.length; index++) {
      expect(expandedHeights[index], `primary row ${index} keeps its readable height`).toBeCloseTo(
        normalHeights[index] ?? 0,
        2,
      );
    }
    await expectReadableMenu(menu);
    await menu.hover();
    const initialScroll = await menu.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => menu.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScroll);
    const last = more.getByRole('menuitem').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expectHitTarget(last);

    await moreButton.click();
    await expect(more).not.toBeVisible();
    await moreButton.click();
    await expect(more).toBeVisible();
    await expectReadableMenu(menu);
    // Resizing an already expanded popup must also keep both edges on screen.
    await page.setViewportSize({ width: 600, height: 380 });
    await expectReadableMenu(menu);
    await page.setViewportSize(viewport);
    await expectReadableMenu(menu);
    await menu.getByRole('menuitem', { name: 'Copy', exact: true }).scrollIntoViewIfNeeded();
    await menu.screenshot({ path: testInfo.outputPath('readable-menu.png') });

    await more.getByRole('menuitem', { name: 'Flip Horizontal', exact: true }).click();
    await expect(menu).not.toBeVisible();
    expect(
      await page.evaluate(async () => {
        const storeUrl = '/src/ui/state/index.ts';
        const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
        const state = useStore.getState();
        return {
          mirrored: state.project.scene.objects.find((object) => object.id === 'menu-square')
            ?.transform.mirrorX,
          undo: state.undoStack.length,
        };
      }),
    ).toEqual({ mirrored: true, undo: 1 });
    expect(errors).toEqual([]);
  });
}

async function expectReadableMenu(menu: Locator): Promise<void> {
  await expect
    .poll(async () =>
      menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 7.5 &&
          bounds.top >= 7.5 &&
          bounds.right <= window.innerWidth - 7.5 &&
          bounds.bottom <= window.innerHeight - 7.5
        );
      }),
    )
    .toBe(true);
  const rows = await menu.getByRole('menuitem').evaluateAll((buttons) =>
    buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        label: button.textContent,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
      };
    }),
  );
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) throw new Error('Menu row missing');
    expect(row.height, `${row.label} has readable height`).toBeGreaterThanOrEqual(20);
    if (index > 0)
      expect(row.top, `${row.label} does not overlap its predecessor`).toBeGreaterThanOrEqual(
        (rows[index - 1]?.bottom ?? 0) - 0.5,
      );
  }
  const visibleHitTargets = await menu.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('button')]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= bounds.top + 8 && rect.bottom <= bounds.bottom - 8;
      })
      .every((button) => {
        const rect = button.getBoundingClientRect();
        return (
          document
            .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            ?.closest('button') === button
        );
      });
  });
  expect(visibleHitTargets).toBe(true);
}

async function expectHitTarget(button: Locator): Promise<void> {
  expect(
    await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest('button') === element
      );
    }),
  ).toBe(true);
}

async function seedMenuScene(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const sceneUrl = '/src/core/scene/index.ts';
    const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
    const { createLayer, IDENTITY_TRANSFORM } = (await import(
      sceneUrl
    )) as typeof import('../src/core/scene');
    const points = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 80 },
    ];
    const objects = [60, 180].map((x, index) => ({
      kind: 'imported-svg' as const,
      id: index === 0 ? 'menu-square' : 'other-square',
      source: 'menu-square.svg',
      transform: { ...IDENTITY_TRANSFORM, x, y: 70 },
      bounds: { minX: 0, minY: 0, maxX: 80, maxY: 80 },
      operationIds: ['menu-line'],
      paths: [{ color: '#4269bb', polylines: [{ closed: true, points }] }],
    }));
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects,
          layers: [createLayer({ id: 'menu-line', name: 'Menu fixture', color: '#4269bb' })],
        },
      },
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  });
}

async function squareEdgeScreen(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const uiUrl = '/src/ui/state/ui-store.ts';
    const viewUrl = '/src/ui/workspace/view-transform.ts';
    const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
    const { useUiStore } = (await import(uiUrl)) as typeof import('../src/ui/state/ui-store');
    const { computeView } = (await import(
      viewUrl
    )) as typeof import('../src/ui/workspace/view-transform');
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="KerfDesk workspace"]',
    );
    if (canvas === null) throw new Error('Workspace canvas missing');
    const rect = canvas.getBoundingClientRect();
    const { device } = useStore.getState().project;
    const view = computeView(
      canvas.width,
      canvas.height,
      device.bedWidth,
      device.bedHeight,
      useUiStore.getState(),
    );
    return {
      x: rect.left + ((view.offsetX + 60 * view.scale) * rect.width) / canvas.width,
      y: rect.top + ((view.offsetY + 110 * view.scale) * rect.height) / canvas.height,
    };
  });
}
