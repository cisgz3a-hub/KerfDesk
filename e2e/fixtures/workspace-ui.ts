import type { Locator, Page } from '@playwright/test';

/** Occasional setup actions now live behind a named disclosure in the Machine panel. */
export async function expandMachineUtilities(page: Page): Promise<void> {
  const summary = page.locator('.lf-machine-rail summary').filter({
    hasText: /^Homing & (focus|maintenance)$/,
  });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
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
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
