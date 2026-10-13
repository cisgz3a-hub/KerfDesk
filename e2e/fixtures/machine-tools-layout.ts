import { expect, type Locator, type Page } from '@playwright/test';

/** Check actual machine containment, rather than merely staying in the viewport. */
export async function expectMachineToolContainment(
  page: Page,
  panel: Locator,
  allowShortWindowScroll = false,
): Promise<void> {
  const layout = await panel.evaluate((element) => {
    const rect = (node: Element) => {
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const clip = (node: Element) => {
      const bounds = rect(node);
      bounds.left = Math.max(0, bounds.left);
      bounds.top = Math.max(0, bounds.top);
      bounds.right = Math.min(innerWidth, bounds.right);
      bounds.bottom = Math.min(innerHeight, bounds.bottom);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const parentRect = rect(parent);
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          bounds.left = Math.max(bounds.left, parentRect.left);
          bounds.right = Math.min(bounds.right, parentRect.right);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          bounds.top = Math.max(bounds.top, parentRect.top);
          bounds.bottom = Math.min(bounds.bottom, parentRect.bottom);
        }
      }
      return bounds;
    };
    const rail = element.closest('.lf-machine-rail');
    const nav = rail?.querySelector('[aria-label="Machine tool dropdowns"]');
    if (!rail || !nav)
      throw new Error('Tool panel is not inside the machine rail below navigation');
    const protectedRegions = [
      '[aria-label="Artwork / Operations panel"]',
      '[aria-label="Jog and positioning"]',
      '[aria-label="Job actions"]',
    ];
    return {
      panel: rect(element),
      visible: clip(element),
      rail: rect(rail),
      nav: rect(nav),
      followsNav: Boolean(nav.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      protectedRegions: protectedRegions.flatMap((selector) => {
        const region = document.querySelector(selector);
        if (!region || region.getClientRects().length === 0) return [];
        return [{ selector, rect: clip(region) }];
      }),
    };
  });
  expect(layout.followsNav).toBe(true);
  expect(layout.panel.left).toBeGreaterThanOrEqual(layout.rail.left - 1);
  expect(layout.panel.right).toBeLessThanOrEqual(layout.rail.right + 1);
  expect(layout.panel.top).toBeGreaterThanOrEqual(layout.nav.bottom - 1);
  const shown = allowShortWindowScroll ? layout.visible : layout.panel;
  expect(shown.right - shown.left).toBeGreaterThan(0);
  expect(shown.bottom - shown.top).toBeGreaterThan(0);
  expect(shown.top).toBeGreaterThanOrEqual(layout.rail.top - 1);
  expect(shown.bottom).toBeLessThanOrEqual(layout.rail.bottom + 1);
  expect(shown.left).toBeGreaterThanOrEqual(0);
  expect(shown.top).toBeGreaterThanOrEqual(0);
  expect(shown.right).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  expect(shown.bottom).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  for (const region of layout.protectedRegions) {
    const width = Math.max(
      0,
      Math.min(shown.right, region.rect.right) - Math.max(shown.left, region.rect.left),
    );
    const height = Math.max(
      0,
      Math.min(shown.bottom, region.rect.bottom) - Math.max(shown.top, region.rect.top),
    );
    expect(width * height, `Inline utility overlaps ${region.selector}`).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 1,
  );
}
