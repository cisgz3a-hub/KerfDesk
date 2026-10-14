import { expect, test, type Page } from './fixtures/kerfdesk-test';

for (const tool of ['select', 'trace-parts'] as const) {
  test(`rotates overlapping artwork together after Fit to selection in ${tool} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
    await installOverlappingArtwork(page, tool);
    await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
    const before = await selectionState(page);
    const geometry = await rotationGeometry(page);
    // The round control must remain visible near the selection after zooming.
    // The previous 24 mm offset pushed it above the canvas in this fixture.
    expect(geometry.scale).toBeGreaterThan(4);
    expect(geometry.handlePainted).toBe(true);
    expect(geometry.start.y).toBeGreaterThan(geometry.canvasTop + 5);
    await page.screenshot({ path: test.info().outputPath('overlapping-selection-before.png') });

    if (tool === 'trace-parts') await page.keyboard.down('Shift');
    await page.mouse.move(geometry.start.x, geometry.start.y);
    await page.mouse.down();
    await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 12 });
    await page.mouse.up();
    if (tool === 'trace-parts') await page.keyboard.up('Shift');

    await expect.poll(async () => (await selectionState(page)).rotations[0]).toBeCloseTo(45, 1);
    const rotated = await selectionState(page);
    expect(rotated.selectedIds).toEqual(['rectangle', 'star']);
    expect(rotated.rotations[1]).toBeCloseTo(rotated.rotations[0] ?? 0, 5);
    expect(rotated.undoCount).toBe(before.undoCount + 1);
    await page.screenshot({ path: test.info().outputPath('overlapping-selection-rotated.png') });

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await selectionState(page)).objects).toEqual(before.objects);
    expect((await selectionState(page)).selectedIds).toEqual(before.selectedIds);
  });
}

async function installOverlappingArtwork(page: Page, tool: 'select' | 'trace-parts') {
  await page.evaluate(async (mode) => {
    const storePath = '/src/ui/state/store.ts';
    const uiPath = '/src/ui/state/ui-store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const shapePath = '/src/core/shapes/primitives/index.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const { useUiStore } = (await import(
      /* @vite-ignore */ uiPath
    )) as typeof import('../src/ui/state/ui-store');
    const { createProject, createLayer, IDENTITY_TRANSFORM } = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const { createRectangle, createStar } = (await import(
      /* @vite-ignore */ shapePath
    )) as typeof import('../src/core/shapes/primitives');
    const color = '#000000';
    const rectangle = createRectangle({
      id: 'rectangle',
      color,
      spec: { widthMm: 30, heightMm: 28, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 60 },
    });
    const star = createStar({
      id: 'star',
      color,
      spec: { points: 5, outerRadiusMm: 15, innerRadiusRatio: 0.45 },
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 57 },
    });
    const objects = [rectangle, star].map((object) =>
      mode === 'select'
        ? object
        : {
            id: object.id,
            kind: 'traced-image' as const,
            source: `${object.id}.png`,
            traceMode: 'filled-contours' as const,
            transform: object.transform,
            paths: object.paths,
            bounds: object.bounds,
          },
    );
    const project = createProject();
    useStore.getState().setProject({
      ...project,
      scene: {
        ...project.scene,
        objects,
        layers: [createLayer({ id: 'layer', color, mode: 'cut' })],
      },
    });
    useStore.getState().selectObjects(['rectangle', 'star']);
    useUiStore.getState().setToolMode({ kind: mode });
  }, tool);
}

async function selectionState(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../src/ui/state/store');
    const state = useStore.getState();
    return {
      objects: state.project.scene.objects,
      rotations: state.project.scene.objects.map((object) => object.transform.rotationDeg),
      selectedIds: [state.selectedObjectId, ...state.additionalSelectedIds],
      undoCount: state.undoStack.length,
    };
  });
}

async function rotationGeometry(page: Page) {
  return page.getByLabel('KerfDesk workspace', { exact: true }).evaluate(async (element) => {
    const canvas = element as HTMLCanvasElement;
    const storePath = '/src/ui/state/store.ts';
    const uiPath = '/src/ui/state/ui-store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const viewPath = '/src/ui/workspace/view-transform.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const { useUiStore } = (await import(
      /* @vite-ignore */ uiPath
    )) as typeof import('../src/ui/state/ui-store');
    const { combinedBBox } = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const { computeView } = (await import(
      /* @vite-ignore */ viewPath
    )) as typeof import('../src/ui/workspace/view-transform');
    // Wait for the actual canvas redraw following the toolbar zoom action.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const { project } = useStore.getState();
    const bounds = combinedBBox(project.scene.objects);
    if (bounds === null) throw new Error('Selected artwork is missing');
    const view = computeView(
      canvas.width,
      canvas.height,
      project.device.bedWidth,
      project.device.bedHeight,
      useUiStore.getState(),
    );
    const x = view.offsetX + ((bounds.minX + bounds.maxX) / 2) * view.scale;
    const top = view.offsetY + bounds.minY * view.scale;
    const y = top - 24;
    const centerY = view.offsetY + ((bounds.minY + bounds.maxY) / 2) * view.scale;
    const radius = centerY - y;
    const rect = canvas.getBoundingClientRect();
    const client = (px: number, py: number) => ({
      x: rect.left + (px * rect.width) / canvas.width,
      y: rect.top + (py * rect.height) / canvas.height,
    });
    const pixel = canvas.getContext('2d')?.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return {
      scale: view.scale,
      canvasTop: rect.top,
      handlePainted: pixel !== undefined && (pixel[2] ?? 0) > (pixel[0] ?? 0) + 30,
      start: client(x, y),
      end: client(x + radius / Math.sqrt(2), centerY - radius / Math.sqrt(2)),
    };
  });
}
