import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/kerfdesk-test';
import {
  connectAndHome,
  confirmJobReview,
  dismissNotifications,
  drainHeldSerialWrites,
  frameCurrentJob,
  IDLE,
  programLinesSince,
  reopenProject,
  runMenuCommand,
  serialWriteLineCount,
  serialWrites,
} from './fixtures/recovery-flow';

for (const change of ['edit artwork', 'new canvas then open another job'] as const) {
  test(`frames and runs current artwork after finishing a previous job: ${change}`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    await page.goto('/');
    await reopenProject(page);
    await connectAndHome(page, kerfdesk);
    await frameCurrentJob(page, kerfdesk);
    await kerfdesk.setAutoAcknowledge(false);
    const firstBaseline = serialWriteLineCount(await kerfdesk.events());
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await confirmJobReview(page, kerfdesk);
    await drainHeldSerialWrites(page, kerfdesk, firstBaseline, 100);
    await kerfdesk.emitSerialLine(IDLE);
    const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
    await expect(complete).toBeVisible();
    await complete.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(complete).toHaveCount(0);
    if (change === 'new canvas then open another job') {
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await kerfdesk.setAutoAcknowledge(true);
    await dismissNotifications(page);

    if (change === 'edit artwork') {
      await runMenuCommand(page, 'Edit', 'Select All');
      await page.getByLabel('Selection X position', { exact: true }).fill('70');
      await page.getByLabel('Selection X position', { exact: true }).press('Enter');
    } else {
      await runMenuCommand(page, 'File', 'New');
      const replacement = JSON.parse(
        readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
      );
      replacement.scene.objects[0].transform.x = 60;
      replacement.scene.objects[0].id = 'second-job-square';
      await kerfdesk.setOpenFiles([{ name: 'second-job.lf2', text: JSON.stringify(replacement) }]);
      await reopenProject(page, 'second-job.lf2');
    }
    await expect(page.getByRole('button', { name: 'Frame job', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
    const frameEventBaseline = (await kerfdesk.events()).length;
    await frameCurrentJob(page, kerfdesk);
    // Realtime status queries can occur between line commands and have no
    // newline. Remove those bytes before comparing the dispatched perimeter.
    const frameLines = programLinesSince(await kerfdesk.events(), frameEventBaseline);
    expect(frameLines.filter((line) => /^\$J=.* X/.test(line)).slice(0, 5)).toEqual([
      '$J=G90 G21 X70.000 Y270.000 F6000',
      '$J=G90 G21 X90.000 Y270.000 F6000',
      '$J=G90 G21 X90.000 Y290.000 F6000',
      '$J=G90 G21 X70.000 Y290.000 F6000',
      '$J=G90 G21 X70.000 Y270.000 F6000',
    ]);
    expect(frameLines.indexOf('M5')).toBeLessThan(
      frameLines.findIndex((line) => line.startsWith('$J=')),
    );
    expect(frameLines.indexOf('M9')).toBeLessThan(
      frameLines.findIndex((line) => line.startsWith('$J=')),
    );
    await kerfdesk.setAutoAcknowledge(false);
    const secondBaseline = serialWriteLineCount(await kerfdesk.events());
    const secondOffset = serialWrites(await kerfdesk.events()).length;
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await confirmJobReview(page, kerfdesk);
    await drainHeldSerialWrites(page, kerfdesk, secondBaseline, 100);
    await kerfdesk.emitSerialLine(IDLE);
    await expect(complete).toBeVisible();
    expect(serialWrites(await kerfdesk.events()).slice(secondOffset)).toMatch(
      /G0 X70\.000 Y(?:270|290)\.000/,
    );
    await complete.screenshot({ path: testInfo.outputPath('second-job-completed.png') });
  });
}
