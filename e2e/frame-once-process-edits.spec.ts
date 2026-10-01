import { expect, test } from './fixtures/kerfdesk-test';
import {
  clearAndRetype,
  editAdvisoryProfileValues,
  editProcessValues,
  expectCutWords,
  finalWirePosition,
  frameAppSnapshot,
  frameJogLines,
  lastReviewEstimate,
  openAndFrameOnce,
  runAndFinish,
} from './fixtures/frame-once-process-edits';
import { frameCurrentJob, runMenuCommand } from './fixtures/recovery-flow';

test('one completed Frame allows power and speed retyping and Start emits the new S/F', async ({
  page,
  kerfdesk,
}) => {
  const framedCommands = await openAndFrameOnce(page, kerfdesk);
  await editProcessValues(page, '37', '2300');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
  const lines = await runAndFinish(page, kerfdesk);
  expectCutWords(lines, 370, 2300);
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
});

test('unchanged placement burns again with edited settings and replays after Done without another Frame', async ({
  page,
  kerfdesk,
}) => {
  const framedCommands = await openAndFrameOnce(page, kerfdesk, true);
  const firstRun = await runAndFinish(page, kerfdesk);
  expectCutWords(firstRun, 300, 1500);
  expect(finalWirePosition(firstRun)).toEqual({ x: 10, y: 290 });
  // Keep the completed-job display present while the next cutting values are
  // entered: the previous run must not overwrite the new executable program.
  await editProcessValues(page, '61', '1100');
  expectCutWords(await runAndFinish(page, kerfdesk), 610, 1100);
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expectCutWords(await runAndFinish(page, kerfdesk, 'Run same job again from start'), 610, 1100);
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
});

test('timing estimates and a new no-go warning retain Frame and unchanged executable motion', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const framedCommands = await openAndFrameOnce(page, kerfdesk);
  const original = await runAndFinish(page, kerfdesk);
  const originalEstimate = lastReviewEstimate(page);
  const before = await frameAppSnapshot(page);
  await editAdvisoryProfileValues(page);
  const after = await frameAppSnapshot(page);
  await testInfo.attach('advisory-profile-save-boundary', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
  const current = await runAndFinish(page, kerfdesk, 'Start', /no-go zones?/i);
  expect(lastReviewEstimate(page)).not.toBe(originalEstimate);
  expectCutWords(current, 300, 1500);
  const motion = (lines: readonly string[]): string[] =>
    lines.filter((line) => /^G0?[0123](?:\s|$)/.test(line));
  expect(motion(current)).toEqual(motion(original));
  expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
});

for (const change of [
  { label: 'Selection X position', value: '60', minX: '60.000', maxX: '80.000' },
  { label: 'Selection width', value: '35', minX: '10.000', maxX: '45.000' },
] as const) {
  test(`${change.label} change requires a new Frame and Start uses the new geometry`, async ({
    page,
    kerfdesk,
  }) => {
    const framedCommands = await openAndFrameOnce(page, kerfdesk);
    await runMenuCommand(page, 'Edit', 'Select All');
    await clearAndRetype(page.getByLabel(change.label, { exact: true }), change.value);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
    expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands);
    await frameCurrentJob(page, kerfdesk);
    expect(frameJogLines(await kerfdesk.events()).slice(framedCommands)).toEqual([
      `$J=G90 G21 X${change.minX} Y270.000 F6000`,
      `$J=G90 G21 X${change.maxX} Y270.000 F6000`,
      `$J=G90 G21 X${change.maxX} Y290.000 F6000`,
      `$J=G90 G21 X${change.minX} Y290.000 F6000`,
      `$J=G90 G21 X${change.minX} Y270.000 F6000`,
      '$J=G90 G21 X0.000 Y0.000 F6000',
    ]);
    const lines = await runAndFinish(page, kerfdesk);
    expectCutWords(lines, 300, 1500);
    expect(lines.join('\n')).toContain(`X${change.minX}`);
    expect(lines.join('\n')).toContain(`X${change.maxX}`);
    expect(frameJogLines(await kerfdesk.events())).toHaveLength(framedCommands * 2);
  });
}
