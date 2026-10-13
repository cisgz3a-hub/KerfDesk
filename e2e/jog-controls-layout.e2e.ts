import { test, expect, type Locator } from './fixtures/kerfdesk-test';
import {
  connectMachineAndDismissFirstSetup,
  machineJogAction,
  openMachineToolDropdown,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';
import type { AppState } from '../src/ui/state';
import { expectMachineToolContainment } from './fixtures/machine-tools-layout';

for (const height of [768, 900]) {
  const behavior = height === 900 ? 'stay pinned' : 'remain reachable through short rail scrolling';
  test(`configured jog actions and powered Z ${behavior} at 1366x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1366, height });
    await page.goto('/');
    await selectWorkspacePanel(page, 'Machine');
    await connectMachineAndDismissFirstSetup(page);
    await expect(page.getByRole('region', { name: 'Machine toolbar', exact: true })).toContainText(
      'Connected',
    );
    await page.evaluate(async () => {
      const stateUrl = '/src/ui/state/index.ts';
      const { useStore } = (await import(stateUrl)) as {
        useStore: { getState: () => AppState };
      };
      const device = useStore.getState().project.device;
      useStore.getState().updateDeviceProfile({
        homing: { ...device.homing, enabled: true },
        autofocusCommand: '$HZ1',
        capabilities: [...new Set([...(device.capabilities ?? []), 'z-axis' as const])],
        zTravelConfirmed: true,
        zTravelMm: 50,
      });
    });
    const actions = [
      machineJogAction(page, 'Home'),
      machineJogAction(page, 'Auto-focus'),
      machineJogAction(page, 'Set origin here'),
      page.getByRole('button', { name: /^Turn manual air assist on/ }),
      page.getByRole('button', { name: 'Jog Z+ 1 mm', exact: true }),
      page.getByRole('button', { name: 'Jog Z- 1 mm', exact: true }),
    ];
    for (const action of actions) {
      await expect(action).toBeEnabled();
      await expectUnclippedPointerTarget(action);
    }
    const positions = await Promise.all(actions.map((action) => action.boundingBox()));
    const dock = page.getByRole('region', { name: 'Job actions', exact: true });
    const dockPosition = await dock.boundingBox();
    const rail = page.getByLabel('Laser controls', { exact: true });
    const tools = page.getByRole('region', { name: 'Machine tools', exact: true });
    await expect
      .poll(() => tools.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
      .toBe(true);
    await page.screenshot({ path: info.outputPath('machine-configured-laptop.png') });
    for (const name of ['Origin', 'Placement & output', 'Console'] as const) {
      const panel = await openMachineToolDropdown(page, name);
      if (height === 768) await panel.scrollIntoViewIfNeeded();
      await expectMachineToolContainment(page, panel, height === 768);
      expect(await dock.boundingBox()).toEqual(dockPosition);
      if (height === 900) {
        for (const [index, action] of actions.entries()) {
          expect(await action.boundingBox()).toEqual(positions[index]);
          await expectUnclippedPointerTarget(action);
        }
      } else {
        const field =
          name === 'Origin'
            ? panel.getByRole('button', { name: 'Reset origin', exact: true })
            : name === 'Placement & output'
              ? panel.getByRole('combobox', { name: 'Start from', exact: true })
              : panel.getByRole('textbox', { name: 'Console command', exact: true });
        await field.scrollIntoViewIfNeeded();
        await expectUnclippedPointerTarget(field);
      }
      await page.screenshot({
        path: info.outputPath(`inline-configured-${name.split(' ')[0]}.png`),
      });
      const close = panel.getByRole('button', { name: `Close ${name}`, exact: true });
      await close.scrollIntoViewIfNeeded();
      await close.click();
      if (height === 768)
        await rail.evaluate((element) => {
          element.scrollTop = 0;
        });
      for (const [index, action] of actions.entries()) {
        expect(await action.boundingBox()).toEqual(positions[index]);
        await expectUnclippedPointerTarget(action);
      }
    }
    for (const [index, action] of actions.entries()) {
      expect(await action.boundingBox()).toEqual(positions[index]);
      await expectUnclippedPointerTarget(action);
    }
  });
}

test('center Home and adjacent auto-focus setup remain keyboard and pointer accessible', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await selectWorkspacePanel(page, 'Machine');
  const homing = machineJogAction(page, 'Set up homing');
  await expect(homing).toBeEnabled();
  await expectUnclippedPointerTarget(homing);
  const bounds = await homing.boundingBox();
  if (bounds === null) throw new Error('Home setup has no pointer target');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await expect(setup.getByRole('checkbox', { name: 'Homing enabled', exact: true })).toBeVisible();
  await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await expect(homing).toBeFocused();
  const autofocus = machineJogAction(page, 'Set up auto-focus');
  await expectUnclippedPointerTarget(autofocus);
  await autofocus.focus();
  await autofocus.press('Enter');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await expect(autofocus).toBeFocused();
  await expect(machineJogAction(page, 'Set origin here')).toBeDisabled();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

async function expectUnclippedPointerTarget(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const reachable = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const parentBounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, parentBounds.left);
        clip.right = Math.min(clip.right, parentBounds.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, parentBounds.top);
        clip.bottom = Math.min(clip.bottom, parentBounds.bottom);
      }
    }
    const target = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    return {
      fullyVisible:
        bounds.left >= clip.left - 1 &&
        bounds.top >= clip.top - 1 &&
        bounds.right <= clip.right + 1 &&
        bounds.bottom <= clip.bottom + 1,
      pointerHitsControl: target !== null && element.contains(target),
    };
  });
  expect(reachable).toEqual({ fullyVisible: true, pointerHitsControl: true });
}
