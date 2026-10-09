import { expect, type Locator, type Page } from '@playwright/test';

export async function connectMachineThroughToolbar(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: 'Machine toolbar', exact: true })
    .getByRole('button', { name: 'Connect', exact: true })
    .click();
}

/** Transport workflows cancel the first setup offer through the ordinary UI. */
export async function connectMachineAndDismissFirstSetup(page: Page): Promise<void> {
  await connectMachineThroughToolbar(page);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  // Explicit Connect opens this synchronously for an unconfigured profile.
  // An already configured profile can connect without an offer to dismiss.
  if (await setup.isVisible()) {
    await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await expect(setup).not.toBeVisible();
  }
}

/** Ordinary machine setup and origin actions stay visible with jog controls. */
export function machineJogAction(
  page: Page,
  name: 'Home' | 'Set up homing' | 'Auto-focus' | 'Set up auto-focus' | 'Set origin here',
): Locator {
  return page
    .getByRole('region', { name: 'Jog and positioning', exact: true })
    .getByRole('button', { name, exact: true });
}

/** CNC utilities remain behind their own disclosure below the ordinary actions. */
export async function expandMachineMaintenance(page: Page): Promise<void> {
  const summary = page
    .getByLabel('Router controls', { exact: true })
    .locator('summary')
    .filter({ hasText: /^Machine maintenance$/ });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
}

export function applicationHeader(page: Page): Locator {
  return page.getByRole('banner').filter({
    has: page.getByRole('menubar', { name: 'Application menu', exact: true }),
  });
}

/** Reach the same command whether the responsive toolbar shows it or puts it in More. */
export async function toolbarCommand(page: Page, name: string): Promise<Locator> {
  const button = page
    .getByRole('banner', { name: 'Toolbar', exact: true })
    .getByRole('button', { name, exact: true });
  const menu = page.getByRole('menu', { name: 'More commands', exact: true });
  if (!(await button.isVisible()) && !(await menu.isVisible())) {
    await page.getByRole('button', { name: 'More commands', exact: true }).click();
  }
  // Async imports can make Trace eligible while this helper opens More. Keep
  // the locator live across that move instead of pinning it to the old surface.
  return button
    .or(menu.getByRole('menuitem', { name, exact: true }))
    .or(menu.getByRole('menuitemcheckbox', { name, exact: true }));
}

/** Spacious layouts show both panels; compact layouts expose each through its tab. */
export async function selectWorkspacePanel(page: Page, name: 'Artwork' | 'Machine'): Promise<void> {
  await page.getByRole('region', { name: 'Workspace side panels', exact: true }).waitFor();
  const tab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
