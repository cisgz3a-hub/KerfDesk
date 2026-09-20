import type { Locator, Page } from '@playwright/test';

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
  if (await button.isVisible()) return button;
  const menu = page.getByRole('menu', { name: 'More commands', exact: true });
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: 'More commands', exact: true }).click();
  }
  return menu
    .getByRole('menuitem', { name, exact: true })
    .or(menu.getByRole('menuitemcheckbox', { name, exact: true }));
}

/** Spacious layouts show both panels; compact layouts expose each through its tab. */
export async function selectWorkspacePanel(page: Page, name: 'Artwork' | 'Machine'): Promise<void> {
  await page.getByRole('region', { name: 'Workspace side panels', exact: true }).waitFor();
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
