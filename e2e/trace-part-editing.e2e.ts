import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Project, TracedImage, Vec2 } from '../src/core/scene';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

test.use({ viewport: { width: 1600, height: 1000 } });

test('edits only picked trace parts, preserves holes, and saves the edited artwork', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(120_000);
  const blank = JSON.parse(
    readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
  ) as Project;
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'trace-parts.lf2', text: JSON.stringify({ ...blank, scene: { objects: [] } }) },
  ]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/trace-parts\.lf2/);
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Missing fixture canvas context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 960, 640);
    context.fillStyle = '#000';
    context.fillRect(80, 120, 240, 280);
    context.fillRect(420, 120, 200, 280);
    context.beginPath();
    context.moveTo(720, 400);
    context.lineTo(820, 120);
    context.lineTo(920, 400);
    context.closePath();
    context.fill();
    context.fillStyle = '#fff';
    context.fillRect(120, 160, 160, 200);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await kerfdesk.setOpenFiles([{ name: 'three-parts.png', base64, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  const traceButton = await toolbarCommand(page, 'Trace Image...');
  await expect(traceButton).toBeEnabled();
  await traceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).traces.length).toBe(1);
  await dismissNotifications(page);
  await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();

  const initial = await snapshot(page);
  const trace = initial.traces[0];
  if (trace === undefined) throw new Error('Missing committed trace');
  expect(contours(initial.traces)).toHaveLength(4);
  const ringPoint = leftmostContourPoint(trace);
  const tool = page
    .getByRole('complementary', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Edit trace parts', exact: true });
  const hint = page.getByRole('status').filter({ hasText: 'Move a single part of this trace' });
  await expect(hint).toBeVisible();
  await hint.getByRole('button', { name: 'Edit trace parts', exact: true }).click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Drag a traced line or shape.', { exact: false })).toBeVisible();
  const from = await screenPoint(page, trace, ringPoint);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 36, from.y + 30, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await snapshot(page)).traces.length).toBe(2);
  const moved = await snapshot(page);
  const ring = moved.traces.find((object) => object.id === moved.selectedIds[0]);
  const remainder = moved.traces.find((object) => object.id !== ring?.id);
  if (ring === undefined || remainder === undefined) throw new Error('Missing separated parts');
  expect(contours([ring])).toHaveLength(2);
  expect(contours([remainder])).toHaveLength(2);
  expect(contours(moved.traces)).toEqual(contours(initial.traces));
  expect(remainder.transform).toEqual(trace.transform);
  expect(ring.transform.x).toBeGreaterThan(trace.transform.x);
  expect(ring.transform.y).toBeGreaterThan(trace.transform.y);
  expect(ring.operationIds).toEqual(trace.operationIds);
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('moved-trace-part.png') });
  await info.attach('Moved individual traced ring', {
    path: info.outputPath('moved-trace-part.png'),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Done editing trace parts', exact: true }).click();
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).traces).toEqual(moved.traces);
  await tool.click();

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot(page)).traces).toEqual(initial.traces);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await snapshot(page)).traces).toEqual(moved.traces);

  // Shift-pick another part through the canvas, then nudge only the two selections.
  // History restores geometry; explicitly select the moved ring again first.
  const ringAgain = await screenPoint(page, ring, leftmostContourPoint(ring));
  await page.mouse.click(ringAgain.x, ringAgain.y);
  await expect.poll(async () => (await snapshot(page)).selectedIds).toEqual([ring.id]);
  const secondPoint = await screenPoint(page, remainder, leftmostContourPoint(remainder));
  await page.keyboard.down('Shift');
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.keyboard.up('Shift');
  const selected = await snapshot(page);
  expect(selected.traces).toHaveLength(3);
  expect(selected.selectedIds).toHaveLength(2);
  expect(selected.selectedIds).toContain(ring.id);
  await page.keyboard.press('ArrowRight');
  const nudged = await snapshot(page);
  for (const before of selected.traces) {
    const after = nudged.traces.find((object) => object.id === before.id);
    if (after === undefined) throw new Error('Nudge lost a part');
    if (selected.selectedIds.includes(before.id))
      expect(after.transform.x).toBeGreaterThan(before.transform.x);
    else expect(after).toEqual(before);
  }
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await snapshot(page)).traces.length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot(page)).traces).toEqual(nudged.traces);

  // Existing node controls are reachable from this editing workflow.
  await page
    .getByRole('complementary', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Edit nodes', exact: true })
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Drawing tools' })
      .getByRole('button', { name: 'Edit nodes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const nodeRing = nudged.traces.find((object) => object.id === ring.id);
  if (nodeRing === undefined) throw new Error('Missing ring for node edit');
  const node = nodeRing.paths[0]?.curves?.[0]?.start;
  if (node === undefined) throw new Error('Trace did not retain editable curves');
  const at = await screenPoint(page, nodeRing, node);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('button', { name: 'Node coordinates', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Node coordinates', exact: true }).click();
  const nodeX = page.getByRole('textbox', { name: 'Node X coordinate', exact: true });
  const oldX = Number(await nodeX.inputValue());
  await nodeX.fill(String(oldX + 2));
  await nodeX.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Done editing nodes', exact: true }).click();
  await expect(page.getByTestId('node-edit-layer')).toBeHidden();
  const edited = await snapshot(page);
  expect(edited.traces.find((object) => object.id === ring.id)?.paths).not.toEqual(nodeRing.paths);
  for (const other of nudged.traces.filter((object) => object.id !== ring.id)) {
    expect(edited.traces.find((object) => object.id === other.id)).toEqual(other);
  }

  await saveProjectAs(page, kerfdesk);
  const saved = Object.values(await kerfdesk.savedFiles()).find((text) =>
    text.includes('traced-image'),
  );
  if (saved === undefined) throw new Error('Missing saved trace-parts project');
  const savedProject = JSON.parse(saved) as Project;
  expect(
    explicitLineCurves(
      savedProject.scene.objects.filter((object) => object.kind === 'traced-image'),
    ),
  ).toEqual(explicitLineCurves(edited.traces));
  await kerfdesk.setOpenFiles([{ name: 'edited-trace-parts.lf2', text: saved }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/edited-trace-parts\.lf2/);
  await expect
    .poll(async () => explicitLineCurves((await snapshot(page)).traces))
    .toEqual(explicitLineCurves(edited.traces));
  expect((await kerfdesk.events()).some((event) => event.kind === 'serial-write')).toBe(false);
});

test('picks one part of a 4096-shape bitmap trace without expanding every shape', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const blank = JSON.parse(
    readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
  ) as Project;
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'dense-trace.lf2', text: JSON.stringify({ ...blank, scene: { objects: [] } }) },
  ]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/dense-trace\.lf2/);
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1808;
    canvas.height = 1808;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Missing dense fixture canvas');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 64; row += 1) {
      for (let column = 0; column < 64; column += 1) {
        const x = 12 + column * 28;
        const y = 12 + row * 28;
        context.fillStyle = '#000';
        context.fillRect(x, y, 18, 18);
        context.fillStyle = '#fff';
        context.fillRect(x + 4, y + 4, 10, 10);
      }
    }
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await kerfdesk.setOpenFiles([{ name: '4096-rings.png', base64, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  const traceButton = await toolbarCommand(page, 'Trace Image...');
  await expect(traceButton).toBeEnabled();
  const traceStarted = performance.now();
  await traceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const traceElapsedMs = performance.now() - traceStarted;
  await expect.poll(async () => (await snapshot(page)).traces.length).toBe(1);
  await dismissNotifications(page);
  await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
  const initial = await snapshot(page);
  const trace = initial.traces[0];
  if (trace === undefined) throw new Error('Dense trace was not committed');
  const beforeContours = contours(initial.traces);
  expect(beforeContours).toHaveLength(8192);
  const fingerprint = createHash('sha256').update(beforeContours.join('\n')).digest('hex');
  const points = trace.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const centerX = (trace.bounds.minX + trace.bounds.maxX) / 2;
  const centerY = (trace.bounds.minY + trace.bounds.maxY) / 2;
  const point = points.reduce<Vec2 | undefined>(
    (best, candidate) =>
      best === undefined ||
      Math.hypot(candidate.x - centerX, candidate.y - centerY) <
        Math.hypot(best.x - centerX, best.y - centerY)
        ? candidate
        : best,
    undefined,
  );
  if (point === undefined) throw new Error('Dense trace has no contour');
  const preparationWorkers: string[] = [];
  page.on('worker', (worker) => {
    if (worker.url().includes('trace-part-worker')) preparationWorkers.push(worker.url());
  });
  await page
    .getByRole('complementary', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Edit trace parts', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Editing trace parts' })).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 60_000 },
  );
  expect(preparationWorkers).toHaveLength(1);
  const from = await screenPoint(page, trace, point);
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.start');
  const pickStarted = performance.now();
  await page.mouse.move(from.x, from.y);
  const hoverFinished = performance.now();
  await page.mouse.down();
  const downFinished = performance.now();
  await page.mouse.move(from.x + 45, from.y + 38, { steps: 6 });
  const dragFinished = performance.now();
  await page.mouse.up();
  const upFinished = performance.now();
  await expect.poll(async () => traceCount(page)).toBe(2);
  const firstPickAndDragElapsedMs = performance.now() - pickStarted;
  const { profile } = await profiler.send('Profiler.stop');
  await profiler.detach();
  const profilePath = info.outputPath('dense-trace-editing.cpuprofile');
  writeFileSync(profilePath, JSON.stringify(profile));
  await info.attach('Dense trace editing CPU profile', {
    path: profilePath,
    contentType: 'application/json',
  });
  const snapshotStarted = performance.now();
  const moved = await snapshot(page);
  const snapshotElapsedMs = performance.now() - snapshotStarted;
  const ring = moved.traces.find((object) => object.id === moved.selectedIds[0]);
  const remainder = moved.traces.find((object) => object.id !== ring?.id);
  if (ring === undefined || remainder === undefined) throw new Error('Dense extraction missing');
  expect(contours([ring])).toHaveLength(2);
  expect(contours([remainder])).toHaveLength(8190);
  expect(remainder.transform).toEqual(trace.transform);
  expect(ring.transform).not.toEqual(trace.transform);
  const afterFingerprint = createHash('sha256')
    .update(contours(moved.traces).join('\n'))
    .digest('hex');
  expect(afterFingerprint).toBe(fingerprint);
  expect(failures).toEqual([]);
  const measurementPath = info.outputPath('dense-trace-measurements.json');
  writeFileSync(
    measurementPath,
    JSON.stringify(
      {
        sourcePixels: [1808, 1808],
        shapes: 4096,
        contours: beforeContours.length,
        sourceContourFingerprint: fingerprint,
        afterContourFingerprint: afterFingerprint,
        sceneObjectsAfterPick: moved.traces.length,
        traceElapsedMs,
        firstPickAndDragElapsedMs,
        pointerPhasesMs: {
          hover: hoverFinished - pickStarted,
          down: downFinished - hoverFinished,
          drag: dragFinished - downFinished,
          up: upFinished - dragFinished,
        },
        snapshotElapsedMs,
        preparationWorkers: preparationWorkers.length,
        note: 'Observed wall time on a busy development machine; no performance threshold or hardware claim.',
      },
      null,
      2,
    ),
  );
  await info.attach('Dense trace editing measurements', {
    path: measurementPath,
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('dense-trace-one-moved-part.png') });
  await info.attach('One edited part of 4096 traced shapes', {
    path: info.outputPath('dense-trace-one-moved-part.png'),
    contentType: 'image/png',
  });
});

async function traceCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { project: Project } };
    };
    return useStore
      .getState()
      .project.scene.objects.filter((object) => object.kind === 'traced-image').length;
  });
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          project: Project;
          selectedObjectId: string | null;
          additionalSelectedIds: ReadonlySet<string>;
        };
      };
    };
    const state = useStore.getState();
    return {
      traces: state.project.scene.objects.filter(
        (object): object is TracedImage => object.kind === 'traced-image',
      ),
      selectedIds: [state.selectedObjectId, ...state.additionalSelectedIds].filter(
        (id): id is string => id !== null,
      ),
    };
  });
}

function contours(objects: readonly TracedImage[]): string[] {
  return objects
    .flatMap((object) =>
      object.paths.flatMap((path) =>
        (path.curves ?? path.polylines).map((curve) => JSON.stringify(curve)),
      ),
    )
    .sort();
}

// The project format may omit exactly redundant all-line curves. Compare their
// geometry and metadata independently of this permitted storage compaction.
function explicitLineCurves(objects: readonly TracedImage[]) {
  return objects.map((object) => ({
    ...object,
    paths: object.paths.map((path) => ({
      ...path,
      curves:
        path.curves ??
        path.polylines.map((line) => ({
          start: line.points[0],
          segments: line.points.slice(1).map((to) => ({ kind: 'line', to })),
          closed: line.closed,
        })),
    })),
  }));
}

function leftmostContourPoint(object: TracedImage): Vec2 {
  const points = object.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const point = points.reduce<Vec2 | undefined>(
    (best, point) => (best === undefined || point.x < best.x ? point : best),
    undefined,
  );
  if (point === undefined) throw new Error('No contour point');
  return point;
}

async function screenPoint(page: Page, object: TracedImage, point: Vec2) {
  return page.evaluate(
    async ({ transform, point }) => {
      const path = '/src/ui/state/store.ts';
      const uiPath = '/src/ui/state/ui-store.ts';
      const { useStore } = (await import(/* @vite-ignore */ path)) as {
        useStore: { getState: () => { project: Project } };
      };
      const { useUiStore } = (await import(/* @vite-ignore */ uiPath)) as {
        useUiStore: { getState: () => { zoomFactor: number; panX: number; panY: number } };
      };
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="KerfDesk workspace"]',
      );
      if (canvas === null) throw new Error('Missing workspace canvas');
      const { bedWidth, bedHeight } = useStore.getState().project.device;
      const { zoomFactor, panX, panY } = useUiStore.getState();
      const scale =
        Math.min((canvas.width - 60) / bedWidth, (canvas.height - 60) / bedHeight) * zoomFactor;
      const rad = (transform.rotationDeg * Math.PI) / 180;
      const x = point.x * transform.scaleX * (transform.mirrorX ? -1 : 1);
      const y = point.y * transform.scaleY * (transform.mirrorY ? -1 : 1);
      const sceneX = transform.x + x * Math.cos(rad) - y * Math.sin(rad);
      const sceneY = transform.y + x * Math.sin(rad) + y * Math.cos(rad);
      const rect = canvas.getBoundingClientRect();
      return {
        x:
          rect.left +
          (((canvas.width - bedWidth * scale) / 2 + (panX + sceneX) * scale) * rect.width) /
            canvas.width,
        y:
          rect.top +
          (((canvas.height - bedHeight * scale) / 2 + (panY + sceneY) * scale) * rect.height) /
            canvas.height,
      };
    },
    { transform: object.transform, point },
  );
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss .* notification:/ });
  while (await notifications.count()) await notifications.first().click();
}
