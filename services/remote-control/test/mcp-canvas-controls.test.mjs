/* global window, document */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { stop } from 'esbuild';
import { launch } from './remote-app-support.mjs';
import {
  canvasFixture,
  loadCanvas,
  point,
  clickItem,
  drag,
  selected,
  mutations,
} from './mcp-canvas-controls-support.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  stop();
});

test('mouse modifiers toggle complete groups and ordinary selected clicks retain the set', async () => {
  const { page, context, state, errors } = await loadCanvas(browser);
  try {
    await clickItem(page);
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    await page.keyboard.down('Shift');
    await clickItem(page, 'b');
    await page.keyboard.up('Shift');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    await clickItem(page, 'b');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    await page.keyboard.down('Control');
    await clickItem(page, 'a2');
    await page.keyboard.up('Control');
    await expect.poll(() => selected(page)).toEqual(['b']);
    await page.keyboard.down('Meta');
    await clickItem(page);
    await page.keyboard.up('Meta');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    assert.deepEqual(mutations(state), []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

for (const width of [320, 390, 480, 900]) {
  test(`touch controls at ${width}px toggle, select all and deselect without overflow`, async () => {
    const { page, context, state, errors } = await loadCanvas(browser, canvasFixture(), width);
    try {
      const controls = page.getByRole('toolbar', { name: 'Selection controls' });
      await controls.getByRole('button', { name: 'Multi-select' }).click();
      await clickItem(page, 'a1', true);
      await clickItem(page, 'b', true);
      await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
      const empty = await point(page, 110, 100);
      await page.touchscreen.tap(empty.x, empty.y);
      await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
      await clickItem(page, 'a2', true);
      await expect.poll(() => selected(page)).toEqual(['b']);
      await controls.getByRole('button', { name: 'Select all', exact: true }).click();
      await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      const buttons = await controls
        .getByRole('button')
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      assert.ok(buttons.every((height) => height >= 48));
      const actionsFit = await page
        .getByRole('toolbar', { name: 'Selection', exact: true })
        .evaluate((bar) => {
          const bounds = bar.getBoundingClientRect();
          return [...bar.querySelectorAll('button')].every((button) => {
            const box = button.getBoundingClientRect();
            return (
              box.width >= 48 &&
              box.height >= 48 &&
              box.left >= bounds.left &&
              box.right <= bounds.right
            );
          });
        });
      assert.equal(actionsFit, true, 'Every selection action must fit inside the toolbar');
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('.zoom').getBoundingClientRect().bottom <=
            document.querySelector('.actionbar').getBoundingClientRect().top,
        ),
        true,
        'The selection actions must not cover zoom controls',
      );
      if (process.env.KERFDESK_CANVAS_SCREENSHOTS) {
        await mkdir(process.env.KERFDESK_CANVAS_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(process.env.KERFDESK_CANVAS_SCREENSHOTS, `selection-${width}.png`),
        });
      }
      await controls.getByRole('button', { name: 'Deselect', exact: true }).click();
      await expect.poll(() => selected(page)).toEqual([]);
      await controls.getByRole('button', { name: 'Multi-select' }).click();
      await clickItem(page, 'a1', true);
      await page.touchscreen.tap(empty.x, empty.y);
      await expect.poll(() => selected(page)).toEqual([]);
      assert.deepEqual(mutations(state), []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('directional marquee encloses whole groups, crosses groups and adds with Shift', async () => {
  const { page, context, state } = await loadCanvas(browser);
  try {
    await drag(page, [10, 20], [50, 60]);
    await expect.poll(() => selected(page)).toEqual([]);
    await drag(page, [90, 60], [70, 20]);
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    await page.keyboard.down('Shift');
    await drag(page, [120, 20], [160, 60]);
    await page.keyboard.up('Shift');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    await drag(page, [180, 20], [275, 60]);
    await expect.poll(() => selected(page)).toEqual([]);
    assert.deepEqual(mutations(state), []);
  } finally {
    await context.close();
  }
});

test('Escape cancels a captured drag, then clears selection; drawing Escape discards only its draft', async () => {
  const { page, context, state } = await loadCanvas(browser);
  try {
    await clickItem(page);
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    const at = await point(page, 30, 40);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 30, at.y + 30, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    assert.deepEqual(mutations(state), []);
    await page.keyboard.press('Escape');
    await expect.poll(() => selected(page)).toEqual([]);
    await page.getByRole('button', { name: 'Draw rectangle', exact: true }).click();
    await drag(page, [100, 80], [130, 105]);
    await page.getByRole('toolbar', { name: 'Drawing' }).waitFor();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar', { name: 'Drawing' })).toHaveCount(0);
    assert.deepEqual(mutations(state), []);
  } finally {
    await context.close();
  }
});

test('right and middle drags only pan; tapping a resize handle never writes a no-op', async () => {
  const { page, context, state } = await loadCanvas(browser);
  try {
    await clickItem(page);
    const corner = await point(page, 20, 30);
    await page.mouse.click(corner.x, corner.y);
    const before = await page.evaluate(() => window.subject.store.get().view);
    await drag(page, [30, 40], [40, 50], 'right');
    await drag(page, [30, 40], [45, 55], 'middle');
    const after = await page.evaluate(() => window.subject.store.get().view);
    assert.notEqual(after.x, before.x);
    assert.deepEqual(mutations(state), []);
    assert.deepEqual(await selected(page), ['a1', 'a2']);
  } finally {
    await context.close();
  }
});

for (const action of ['move', 'resize', 'rotate']) {
  test(`group ${action} commits one transform on release`, async () => {
    const { page, context, state } = await loadCanvas(browser);
    try {
      await clickItem(page);
      await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
      if (action === 'move') await drag(page, [30, 40], [40, 45]);
      if (action === 'resize') await drag(page, [80, 50], [110, 60]);
      if (action === 'rotate') {
        const scale = await page.evaluate(() => window.subject.store.get().view.scale);
        const radius = 10 + 30 / scale;
        await drag(page, [50, 40 - radius], [50 + radius, 40]);
      }
      await expect.poll(() => mutations(state).length).toBe(1);
      const sent = mutations(state)[0];
      const transform = action === 'resize' ? sent.args.edits[0].args : sent.args;
      assert.deepEqual(transform.artworkIds, ['a1', 'a2']);
      if (action === 'move') {
        assert.equal(sent.name, 'transform_artwork');
        assert.ok(Math.abs(transform.transform.dxMm - 10) < 0.01);
        assert.ok(Math.abs(transform.transform.dyMm - 5) < 0.01);
      }
      if (action === 'resize') {
        assert.equal(sent.name, 'apply_edits');
        assert.equal(sent.args.edits.length, 1);
        assert.ok(Math.abs(transform.transform.widthMm - 90) < 0.01);
        assert.ok(Math.abs(transform.transform.heightMm - 30) < 0.01);
      }
      if (action === 'rotate') assert.equal(transform.transform.angleDeg, 90);
    } finally {
      await context.close();
    }
  });
}

for (const batch of [true, false]) {
  test(`dragging a new target commits its selection and movement (${batch ? 'atomic' : 'legacy'})`, async () => {
    const state = canvasFixture();
    state.workspace.selection = ['b'];
    state.workspace.capabilities.designControl = batch;
    const { page, context, errors } = await loadCanvas(browser, state);
    try {
      await drag(page, [30, 40], [40, 45]);
      await expect.poll(() => mutations(state).length).toBe(1);
      await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
      await page.evaluate(() => window.subject.controller.refreshWorkspace());
      assert.deepEqual(await selected(page), ['a1', 'a2']);
      assert.deepEqual(state.workspace.selection, ['a1', 'a2']);
      const sent = mutations(state)[0];
      if (batch) {
        assert.equal(sent.name, 'apply_edits');
        assert.deepEqual(
          sent.args.edits.map((edit) => edit.command),
          ['set_selection', 'transform_artwork'],
        );
        assert.deepEqual(sent.args.edits[0].args.artworkIds, ['a1', 'a2']);
      } else {
        assert.equal(sent.name, 'transform_artwork');
        assert.deepEqual(
          state.commands
            .filter((item) => item.name === 'set_selection')
            .map((item) => item.args.artworkIds),
          [['a1', 'a2']],
        );
      }
      const transformed = batch ? sent.args.edits[1].args : sent.args;
      assert.deepEqual(transformed.artworkIds, ['a1', 'a2']);
      assert.ok(Math.abs(transformed.transform.dxMm - 10) < 0.01);
      assert.ok(Math.abs(transformed.transform.dyMm - 5) < 0.01);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('Escape during a new-target drag preserves the prior desktop selection', async () => {
  const state = canvasFixture();
  state.workspace.selection = ['b'];
  const { page, context } = await loadCanvas(browser, state);
  try {
    const start = await point(page, 30, 40),
      end = await point(page, 40, 45);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    assert.deepEqual(await selected(page), ['b']);
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().preview.ids), [
      'a1',
      'a2',
    ]);
    await expect(page.locator('rect.sel-box')).toHaveAttribute('x', '20');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.evaluate(() => window.subject.controller.refreshWorkspace());
    assert.deepEqual(await selected(page), ['b']);
    assert.deepEqual(state.workspace.selection, ['b']);
    assert.equal(await page.evaluate(() => window.subject.store.get().preview), null);
    await expect(page.locator('rect.sel-box')).toHaveAttribute('x', '130');
    assert.equal(await page.evaluate(() => window.subject.store.get().selectionSync), 'desktop');
    assert.deepEqual(mutations(state), []);
    assert.equal(state.commands.filter((item) => item.name === 'set_selection').length, 0);
  } finally {
    await context.close();
  }
});

test('two-finger navigation preserves the selection and produces no artwork action', async () => {
  const { page, context, state } = await loadCanvas(browser, canvasFixture(), 390);
  const cdp = await context.newCDPSession(page);
  try {
    await clickItem(page, 'a1', true);
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    const center = await point(page, 150, 110);
    const before = await page.evaluate(() => window.subject.store.get().view);
    const fingers = (distance) => [
      { id: 1, x: center.x - distance, y: center.y },
      { id: 2, x: center.x + distance, y: center.y },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(50) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await page.evaluate(() => window.subject.store.get().view);
    assert.ok(after.scale > before.scale);
    assert.deepEqual(await selected(page), ['a1', 'a2']);
    assert.deepEqual(mutations(state), []);
  } finally {
    await cdp.detach();
    await context.close();
  }
});

test('hidden and locked items cannot be selected; view-only selection never writes to the PC', async () => {
  const state = canvasFixture();
  state.scopes = ['read'];
  state.workspace.permissions.canEdit = false;
  const { page, context } = await loadCanvas(browser, state);
  try {
    await clickItem(page, 'hidden');
    await clickItem(page, 'locked');
    assert.deepEqual(await selected(page), []);
    await clickItem(page, 'a1');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2']);
    await page.keyboard.press('Control+a');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(mutations(state), []);
    assert.equal(
      state.commands.some((item) => item.name === 'set_selection'),
      false,
    );
  } finally {
    await context.close();
  }
});

for (const change of ['revision', 'tool', 'view', 'connection', 'sheet']) {
  test(`a captured transform is cancelled when its ${change} changes`, async () => {
    const { page, context, state } = await loadCanvas(browser);
    try {
      await clickItem(page);
      const at = await point(page, 30, 40);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 30, at.y + 25, { steps: 3 });
      await page.evaluate((change) => {
        const { store, controller } = window.subject;
        const current = store.get();
        if (change === 'revision')
          store.set({ workspace: { ...current.workspace, revision: 'r2' } });
        if (change === 'tool') store.set({ tool: 'pan' });
        if (change === 'view')
          store.set({ view: { ...current.view, scale: current.view.scale * 1.1 } });
        if (change === 'connection') controller.start(window.transport);
        if (change === 'sheet') store.set({ sheet: { kind: 'properties' } });
      }, change);
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.subject.store.get().preview), null);
      assert.deepEqual(mutations(state), []);
    } finally {
      await context.close();
    }
  });
}

test('Ctrl/Cmd+A is artwork selection only outside text input, contenteditable and sheets', async () => {
  const { page, context, state } = await loadCanvas(browser);
  try {
    await page.locator('.canvas-wrap').focus();
    await page.keyboard.press('Control+a');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    await page.keyboard.press('Escape');
    await expect.poll(() => selected(page)).toEqual([]);
    await page.keyboard.press('Meta+a');
    await expect.poll(() => selected(page)).toEqual(['a1', 'a2', 'b']);
    for (const tag of ['input', 'contenteditable']) {
      await page.evaluate((tag) => {
        const input = document.createElement(tag === 'input' ? 'input' : 'div');
        input.id = 'typing';
        if (tag === 'input') input.value = 'text';
        else {
          input.contentEditable = 'true';
          input.textContent = 'text';
        }
        document.body.append(input);
        input.focus();
      }, tag);
      const before = state.commands.length;
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Escape');
      assert.equal(state.commands.length, before);
      await page.locator('#typing').evaluate((input) => input.remove());
    }
    await page.getByRole('button', { name: 'Properties', exact: true }).click();
    const before = state.commands.length;
    await page.keyboard.press('Control+a');
    assert.equal(state.commands.length, before);
    assert.deepEqual(mutations(state), []);
  } finally {
    await context.close();
  }
});

test('a native selection larger than its projection shows the total and cannot transform a prefix', async () => {
  const state = canvasFixture();
  state.workspace.selection = ['a1', 'a2'];
  state.workspace.selectionTruncated = true;
  state.workspace.totalSelected = 300;
  const { page, context } = await loadCanvas(browser, state);
  try {
    await expect(page.getByRole('toolbar', { name: 'Selection', exact: true })).toContainText(
      '300 selected',
    );
    await expect(page.getByRole('button', { name: 'Properties', exact: true })).toBeDisabled();
    await drag(page, [30, 40], [40, 50]);
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(mutations(state), []);
    const before = state.commands.filter((item) => item.name === 'set_selection').length;
    await page.keyboard.down('Shift');
    await clickItem(page, 'a1');
    await drag(page, [120, 20], [160, 60]);
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: 'Multi-select', exact: true }).click();
    await clickItem(page, 'b', true);
    assert.equal(state.commands.filter((item) => item.name === 'set_selection').length, before);
    assert.deepEqual(await selected(page), ['a1', 'a2']);
    await page
      .getByRole('toolbar', { name: 'Selection controls' })
      .getByRole('button', { name: 'Deselect' })
      .click();
    await expect.poll(() => selected(page)).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const action of ['button', 'escape', 'empty-canvas']) {
  test('clears a private-ID-only PC selection through ' + action, async () => {
    const state = canvasFixture();
    state.workspace.selection = [];
    state.workspace.totalSelected = 1;
    state.workspace.selectionTruncated = true;
    const { page, context } = await loadCanvas(browser, state);
    try {
      const clear = page
        .getByRole('toolbar', { name: 'Selection controls' })
        .getByRole('button', { name: 'Deselect', exact: true });
      await expect(clear).toBeEnabled();
      if (action === 'button') await clear.click();
      else if (action === 'escape') {
        await page.locator('.canvas-wrap').focus();
        await page.keyboard.press('Escape');
      } else {
        const empty = await point(page, 110, 100);
        await page.mouse.click(empty.x, empty.y);
      }
      await expect
        .poll(() => state.commands.filter((item) => item.name === 'set_selection').length)
        .toBe(1);
      assert.deepEqual(
        state.commands.find((item) => item.name === 'set_selection').args.artworkIds,
        [],
      );
      state.workspace.totalSelected = 0;
      state.workspace.selectionTruncated = false;
      await page.evaluate(() => window.subject.controller.refreshWorkspace());
      await expect(clear).toBeDisabled();
    } finally {
      await context.close();
    }
  });
}

test('390px selection actions remain visible with wider system-font metrics', async () => {
  const { page, context } = await loadCanvas(browser, canvasFixture(), 390);
  try {
    await clickItem(page, 'a1', true);
    await page.addStyleTag({
      content: '.actionbar button, .actionbar .count { font-family: monospace; font-size: 13px; }',
    });
    const bounds = await page
      .getByRole('toolbar', { name: 'Selection', exact: true })
      .evaluate((bar) => {
        const bounds = bar.getBoundingClientRect();
        return {
          overflow: bar.scrollWidth > bar.clientWidth,
          actionsFit: [...bar.querySelectorAll('button')].every((button) => {
            const box = button.getBoundingClientRect();
            return (
              box.width >= 48 &&
              box.height >= 48 &&
              box.left >= bounds.left &&
              box.right <= bounds.right
            );
          }),
        };
      });
    assert.deepEqual(bounds, { overflow: false, actionsFit: true });
    if (process.env.KERFDESK_CANVAS_SCREENSHOTS) {
      await mkdir(process.env.KERFDESK_CANVAS_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: join(process.env.KERFDESK_CANVAS_SCREENSHOTS, 'selection-390-wide-font.png'),
      });
    }
  } finally {
    await context.close();
  }
});

for (const shared of [true, false])
  test(`ineligible group stays unselectable when hidden members are omitted, sharing=${shared}`, async () => {
    const data = canvasFixture();
    data.workspace.artwork = data.workspace.artwork.map((item) =>
      item.id === 'a1' || item.id === 'a2'
        ? { ...item, editable: false, ...(item.id === 'a2' ? { visible: false } : {}) }
        : item,
    );
    data.scene.objects = data.scene.objects.filter(
      (item) => item.id !== 'a2' && (shared || item.id === 'b'),
    );
    data.workspace.permissions.artworkSharingEnabled = shared;
    const { page, context, state } = await loadCanvas(browser, data);
    try {
      await clickItem(page, 'a1');
      assert.deepEqual(await selected(page), []);
      await drag(page, [10, 20], [90, 60]);
      assert.deepEqual(await selected(page), []);
      await page.getByRole('button', { name: 'Select all', exact: true }).click();
      await expect.poll(() => selected(page)).toEqual(['b']);
      assert.equal(
        state.commands.some(
          (item) => item.name === 'set_selection' && item.args.artworkIds?.includes('a1'),
        ),
        false,
      );
    } finally {
      await context.close();
    }
  });

test('truncated Multi-select still permits two-finger navigation without selection writes', async () => {
  const data = canvasFixture();
  data.workspace.selection = ['a1', 'a2'];
  data.workspace.selectionTruncated = true;
  data.workspace.totalSelected = 300;
  const { page, context, state } = await loadCanvas(browser, data, 390);
  const cdp = await context.newCDPSession(page);
  try {
    await page.getByRole('button', { name: 'Multi-select', exact: true }).click();
    const center = await point(page, 150, 110);
    const before = await page.evaluate(() => window.subject.store.get().view);
    const fingers = (distance) => [
      { id: 1, x: center.x - distance, y: center.y },
      { id: 2, x: center.x + distance, y: center.y },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(50) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok((await page.evaluate(() => window.subject.store.get().view)).scale > before.scale);
    assert.deepEqual(await selected(page), ['a1', 'a2']);
    assert.deepEqual(mutations(state), []);
    assert.equal(
      state.commands.some((item) => item.name === 'set_selection'),
      false,
    );
  } finally {
    await cdp.detach();
    await context.close();
  }
});

for (const batch of [true, false])
  test(`unselected replacement drag can replace a truncated selection, batch=${batch}`, async () => {
    const data = canvasFixture();
    data.workspace.selection = ['a1', 'a2'];
    data.workspace.totalSelected = 300;
    data.workspace.selectionTruncated = true;
    data.workspace.capabilities = { ...data.workspace.capabilities, designControl: batch };
    const { page, context, state } = await loadCanvas(browser, data);
    try {
      await drag(page, [140, 40], [150, 45]);
      await expect.poll(() => mutations(state).length).toBe(1);
      const sent = mutations(state)[0];
      const transformed = batch ? sent.args.edits[1].args : sent.args;
      assert.deepEqual(transformed.artworkIds, ['b']);
      assert.ok(Math.abs(transformed.transform.dxMm - 10) < 0.01);
      assert.ok(Math.abs(transformed.transform.dyMm - 5) < 0.01);
    } finally {
      await context.close();
    }
  });
