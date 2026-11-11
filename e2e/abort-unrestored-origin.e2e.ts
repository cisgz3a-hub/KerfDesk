// Rolling audit v10 V3-P2-2 (re-rated P1 by the V9 refuter): on a stock GRBL
// with $10=0, after ABORT JOB a Restore saved origin that cannot write the
// origin says so in a toast, and the next Frame names the unrestored origin
// and the head's distance from it instead of offering to set the origin at the
// head. Declining writes nothing; accepting puts the saved origin back.
// The controller is the in-page journey GRBL (fixtures/journey-grbl-serial.js).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  connectMachineThroughToolbar,
  machineJogAction,
  toolbarCommand,
} from './fixtures/workspace-ui';

const journeyGrbl = readFileSync(
  fileURLToPath(new URL('./fixtures/journey-grbl-serial.js', import.meta.url)),
  'utf8',
);

interface JourneyGrbl {
  readonly wire: string[];
  readonly position: () => { readonly ox: number; readonly oy: number };
  readonly place: (x: number, y: number) => void;
  readonly setWcoReports: (on: boolean) => void;
}
interface JourneyWindow {
  readonly __JOURNEY_GRBL__: JourneyGrbl;
}

const wireLength = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.wire.length);

const workOffset = (page: Page): Promise<{ readonly ox: number; readonly oy: number }> =>
  page.evaluate(() => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.position());

const placeHead = (page: Page, x: number, y: number): Promise<void> =>
  page.evaluate((at) => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.place(at.x, at.y), {
    x,
    y,
  });

const setWcoReports = (page: Page, on: boolean): Promise<void> =>
  page.evaluate(
    (value) => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.setWcoReports(value),
    on,
  );

const g92Since = (page: Page, from: number): Promise<string[]> =>
  page.evaluate(
    (start) =>
      (window as unknown as JourneyWindow).__JOURNEY_GRBL__.wire
        .slice(start)
        .filter((line) => /G92(?!\.)/.test(line)),
    from,
  );

/** A dark disc, so the job is a raster long enough to abort mid-burn. */
async function discPng(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No 2D context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1200, 900);
    context.fillStyle = '#222';
    context.beginPath();
    context.arc(600, 450, 380, 0, Math.PI * 2);
    context.fill();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value === null ? reject(new Error('No PNG')) : resolve(value)));
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  });
}

/** 30 mm wide at (20, 20), run from User Origin. */
async function placeJob(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ modulePath)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app store, read in the page
      useStore: any;
    };
    const state = useStore.getState();
    const object = state.project.scene.objects[0];
    const scale = 30 / ((object.bounds.maxX - object.bounds.minX) * object.transform.scaleX);
    state.setObjectTransform(object.id, {
      ...object.transform,
      scaleX: object.transform.scaleX * scale,
      scaleY: object.transform.scaleY * scale,
      x: 20,
      y: 20,
    });
    const project = useStore.getState().project;
    state.setProject({
      ...project,
      jobSetup: {
        ...project.jobSetup,
        placement: { ...project.jobSetup.placement, startFrom: 'user-origin' },
      },
    });
  });
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('$10=0: a failed restore after Abort is told, and Frame offers the saved origin back', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(600_000);
  // Frame's origin offer is an in-app dialog (ADR-707). No native box is part
  // of this journey; one that appeared would be dismissed here.
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.addInitScript({
    content: 'window.__JOURNEY_GRBL_CONFIG__ = { blocksPerSecond: 200, statusMask: "0" };',
  });
  await page.addInitScript({ content: journeyGrbl });
  await page.goto('/');
  await connectMachineThroughToolbar(page);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  if (
    await setup.waitFor({ timeout: 30_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await expect(setup).not.toBeVisible();
  }

  await kerfdesk.setOpenFiles([
    { name: 'disc.png', base64: await discPng(page), mimeType: 'image/png' },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  const objects = () =>
    page.evaluate(async () => {
      const modulePath = '/src/ui/state/store.ts';
      const { useStore } = (await import(/* @vite-ignore */ modulePath)) as {
        useStore: { getState: () => { project: { scene: { objects: unknown[] } } } };
      };
      return useStore.getState().project.scene.objects.length;
    });
  await expect.poll(objects, { timeout: 120_000 }).toBeGreaterThan(0);
  await placeJob(page);
  for (const button of await page.getByRole('button', { name: /^Dismiss notification/ }).all()) {
    await button.click().catch(() => undefined);
  }
  const machineTab = page.getByRole('tab', { name: 'Machine', exact: true });
  if (await machineTab.isVisible()) await machineTab.click();

  // The origin at machine (60, 40), then Frame, Review and Start.
  await placeHead(page, 60, 40);
  await page.waitForTimeout(2_500);
  await machineJogAction(page, 'Set origin here').click();
  await expect.poll(() => workOffset(page).then((offset) => offset.ox)).toBeCloseTo(60, 3);
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeEnabled({ timeout: 180_000 });
  await start.click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toBeVisible({ timeout: 180_000 });
  await review.getByRole('button', { name: 'Start job' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await page.waitForTimeout(3_000);
  // From here no report carries WCO:, so after the reset the restore has no
  // machine position to aim from within its wait.
  await setWcoReports(page, false);
  await page.getByRole('button', { name: 'ABORT JOB', exact: true }).click();
  const card = page.getByRole('alert').filter({ hasText: 'You stopped the job' }).first();
  await expect(card).toContainText('It was at X 60, Y 40 mm from machine zero.', {
    timeout: 20_000,
  });

  // The card closes with the alarm, and the failure is a toast.
  const restoreFrom = await wireLength(page);
  await card.getByRole('button', { name: 'Restore saved origin', exact: true }).click();
  const notifications = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(notifications).toContainText(
    'Restore saved origin: The saved origin was not written. The controller reports only the ' +
      'work position ($10=0)',
    { timeout: 20_000 },
  );
  await expect(card).toHaveCount(0);
  expect(await g92Since(page, restoreFrom)).toEqual([]);

  // GRBL reports WCO: again. Frame names the saved origin and how far the head
  // is from it. Cancel writes nothing.
  // At Idle KerfDesk polls once a second, and $10=0 sends WCO: on one report in ten.
  await setWcoReports(page, true);
  await page.waitForTimeout(12_000);
  const frame = page.getByRole('button', { name: /^Frame (job|again)$/ });
  const frameFrom = await wireLength(page);
  const offerDialog = page.getByRole('dialog', { name: 'Restore the saved origin?', exact: true });
  await frame.click();
  await expect(offerDialog).toBeVisible({ timeout: 60_000 });
  const offer = await offerDialog.innerText();
  expect(offer).toContain(
    'The job you stopped ran from X 60, Y 40 mm from machine zero, and that origin was not restored.',
  );
  expect(offer).toMatch(/The head is [\d.]+ mm from it \(X [+−]?[\d.]+, Y [+−]?[\d.]+ mm\)\./);
  expect(offer).toContain(
    '"Restore origin" puts the saved origin back with one G92 (the head does not move)',
  );
  expect(offer).not.toContain('set the work origin at the current head position');
  // The buttons name what they do; nothing explains "OK".
  await expect(offerDialog.getByRole('button')).toHaveText(['Restore origin', 'Cancel']);
  await offerDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(offerDialog).toHaveCount(0);
  await page.waitForTimeout(2_000);
  expect(await g92Since(page, frameFrom)).toEqual([]);
  expect((await workOffset(page)).ox).toBeCloseTo(0, 3);

  // Restore origin puts the job's own origin back, and the Frame runs from it.
  const acceptFrom = await wireLength(page);
  await expect(frame).toBeEnabled({ timeout: 60_000 });
  await frame.click();
  await expect(offerDialog).toBeVisible({ timeout: 60_000 });
  await offerDialog.getByRole('button', { name: 'Restore origin', exact: true }).click();
  await expect.poll(() => g92Since(page, acceptFrom), { timeout: 60_000 }).toHaveLength(1);
  await expect.poll(() => workOffset(page).then((offset) => offset.ox)).toBeCloseTo(60, 3);
  expect((await workOffset(page)).oy).toBeCloseTo(40, 3);
  await expect(notifications).toContainText('Origin restored at X 60, Y 40 mm from machine zero.');
  await expect(start).toBeEnabled({ timeout: 180_000 });
});
