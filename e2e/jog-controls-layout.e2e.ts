import { test, expect, type Locator } from './fixtures/kerfdesk-test';
import {
  connectMachineAndDismissFirstSetup,
  machineJogAction,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';
import type { AppState } from '../src/ui/state';

test('configured jog actions and powered Z remain pointer reachable while lower tools scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
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
    page.getByRole('button', { name: 'Jog Z+ 1 mm', exact: true }),
    page.getByRole('button', { name: 'Jog Z- 1 mm', exact: true }),
  ];
  for (const action of actions) {
    await expect(action).toBeEnabled();
    await expectUnclippedPointerTarget(action);
  }
  const positions = await Promise.all(actions.map((action) => action.boundingBox()));
  const tools = page.getByRole('region', { name: 'Machine tools', exact: true });
  const consoleSummary = tools.locator('summary').filter({ hasText: /^Console$/ });
  await consoleSummary.click();
  await expect(consoleSummary.locator('..')).toHaveAttribute('open', '');
  await tools.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  for (const [index, action] of actions.entries()) {
    expect(await action.boundingBox()).toEqual(positions[index]);
    await expectUnclippedPointerTarget(action);
  }
});

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
