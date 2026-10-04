import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { capture, fixtureState, phonePage, visualState } from './phone-workspace-support.mjs';
import { widerFixtureFont } from './machine-ui-support.mjs';
import { assertNoOverflow, loadLive } from './live-ui-support.mjs';
let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

for (const kind of ['phone', 'app'])
  for (const width of [320, 390])
    test(`${kind} live design usability: ${width}px with wider font has three clear views, bounded zoom and no overflow`, async () => {
      const state = await visualState(),
        loaded = await loadLive(browser, kind, state, width);
      try {
        const p = loaded.surface;
        await widerFixtureFont(p);
        for (const name of ['Design', 'Machine', 'Settings']) {
          const button = p.getByRole('button', { name, exact: true });
          const box = await button.boundingBox();
          assert.ok(box.height >= 44 && box.width >= 44, `${name}: ${JSON.stringify(box)}`);
        }
        assert.equal(await p.locator(loaded.image).evaluate((node) => node.naturalWidth > 0), true);
        await p.locator('#zoom-in').click();
        await p.locator('#zoom-in').click();
        assert.equal(await p.locator(loaded.image).evaluate((node) => node.style.width), '200%');
        assert.equal(
          await p
            .locator('#preview-surface')
            .evaluate((node) => globalThis.getComputedStyle(node).overflowX),
          'auto',
        );
        assert.equal(
          await p
            .locator('#preview-surface')
            .evaluate((node) => node.scrollWidth > node.clientWidth),
          true,
        );
        await assertNoOverflow(p);
        await p.locator('#zoom-fit').click();
        await assertNoOverflow(p);
        await p.evaluate(() => globalThis.scrollTo({ top: 0, behavior: 'instant' }));
        await capture(loaded.page, `${kind}-live-design-${width}-wider-font-synthetic`);
        await p.getByRole('button', { name: 'Settings', exact: true }).click();
        assert.equal(
          await p
            .getByRole('button', { name: 'Settings', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        assert.equal(
          await p.getByRole('button', { name: 'Design', exact: true }).getAttribute('aria-pressed'),
          'false',
        );
        assert.equal(
          await p
            .locator(kind === 'phone' ? '#connection-options' : '#settings-panel details')
            .getAttribute('open'),
          null,
        );
        await assertNoOverflow(p);
        await p.evaluate(() => globalThis.scrollTo({ top: 0, behavior: 'instant' }));
        await capture(loaded.page, `${kind}-live-settings-${width}-wider-font-synthetic`);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    });

const computer = 'dae5d95f-d68b-4cfe-809c-af23bf8fa629',
  code = 'FixtureA1234';
for (const fragment of [
  `#device=${computer}&code=${code}`,
  `#device=${computer}&code=${code}&code=${code}`,
  `#device=${computer}&code=${code}&extra=1`,
  '#device=invalid&code=bad',
])
  test(
    'phone pairing fragment: strips before requests and never submits or stores ' +
      (fragment.includes('extra')
        ? 'extra keys'
        : fragment.includes('invalid')
          ? 'malformed'
          : fragment.includes('&code=' + code + '&code')
            ? 'duplicates'
            : 'valid link'),
    async () => {
      const state = fixtureState();
      state.unpaired = true;
      const loaded = await phonePage(browser, state, 390, { suffix: fragment });
      try {
        assert.equal(new URL(loaded.page.url()).hash, '');
        const valid = fragment === `#device=${computer}&code=${code}`;
        assert.equal(
          await loaded.page.locator('#pair-form [name=deviceId]').inputValue(),
          valid ? computer : '',
        );
        assert.equal(
          await loaded.page.locator('#pair-form [name=code]').inputValue(),
          valid ? code : '',
        );
        assert.equal(state.commands.length, 0);
        assert.equal(
          await loaded.page.evaluate(
            () => globalThis.localStorage.length + globalThis.sessionStorage.length,
          ),
          0,
        );
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

test('phone pairing fragment: a history failure prevents all API requests and known MCP help remains navigable', async () => {
  const state = fixtureState();
  state.unpaired = true;
  const blocked = await phonePage(browser, state, 390, {
    suffix: `#device=${computer}&code=${code}`,
    init: () => {
      globalThis.history.replaceState = () => {
        throw new Error('fixture history denied');
      };
    },
  });
  try {
    assert.equal(state.sessionReads ?? 0, 0);
    assert.equal(await blocked.page.locator('#pair-form [name=code]').inputValue(), '');
    assert.equal(await blocked.page.locator('#pair-form button').isDisabled(), true);
    assert.match(await blocked.page.locator('#notice').textContent(), /clean phone control page/);
    assert.deepEqual(blocked.errors, []);
  } finally {
    await blocked.context.close();
  }
  const help = await phonePage(browser, undefined, 390, { suffix: '#mcp' });
  try {
    assert.equal(new URL(help.page.url()).hash, '#mcp');
    assert.equal(
      await help.page
        .getByRole('button', { name: 'Settings', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await help.page.locator('.intro a').getAttribute('href'),
      'https://kerfdesk.com/phone.html#mcp',
    );
    assert.deepEqual(help.errors, []);
  } finally {
    await help.context.close();
  }
});
