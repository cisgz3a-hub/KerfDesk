import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { capture, idle } from './phone-workspace-support.mjs';
import {
  applyDraft,
  choose,
  finger,
  loadTouch,
  touchFixture,
  visibleCanvas,
  writes,
} from './touch-ui-support.mjs';

let browser, previews;
before(async () => {
  browser = await chromium.launch({
    ...(process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
  });
  const painter = await browser.newPage();
  try {
    previews = await painter.evaluate(() => {
      const image = globalThis.document.createElement('canvas');
      image.width = 800;
      image.height = 600;
      const context = image.getContext('2d');
      function draw(revision) {
        context.fillStyle = '#fafafa';
        context.fillRect(0, 0, 800, 600);
        context.strokeStyle = '#d0d6db';
        context.lineWidth = 1;
        for (let line = 0; line <= 800; line += 40) {
          context.beginPath();
          context.moveTo(line, 0);
          context.lineTo(line, 600);
          context.moveTo(0, line);
          context.lineTo(800, line);
          context.stroke();
        }
        context.strokeStyle = '#df3d31';
        context.lineWidth = 3;
        context.strokeRect((20 * 800) / 300, (30 * 600) / 225, 240, 160);
        context.beginPath();
        context.ellipse(500, 280, 80, 80, 0, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = '#203141';
        context.font = '32px sans-serif';
        context.fillText('KerfDesk ' + revision, 250, 500);
        return {
          mimeType: 'image/png',
          data: image.toDataURL('image/png').split(',')[1],
          widthPx: 800,
          heightPx: 600,
        };
      }
      return [draw(1), draw(2)];
    });
  } finally {
    await painter.close();
  }
});
after(async () => {
  await browser?.close();
});

function realFixture() {
  const state = touchFixture();
  state.viewport = { xMm: 0, yMm: 0, widthMm: 300, heightMm: 225 };
  state.preview = previews[0];
  state.artwork = [
    {
      id: 'rectangle-1',
      name: 'Rectangle',
      type: 'rectangle',
      visible: true,
      editable: true,
      bounds: { xMm: 20, yMm: 30, widthMm: 90, heightMm: 60 },
    },
    {
      id: 'ellipse-1',
      name: 'Ellipse',
      type: 'ellipse',
      visible: true,
      editable: true,
      bounds: { xMm: 157.5, yMm: 75, widthMm: 60, heightMm: 60 },
    },
  ];
  return state;
}
async function pose(loaded) {
  const image = await loaded.surface.locator(loaded.image).boundingBox();
  const surface = await loaded.surface.locator('#preview-surface').boundingBox();
  return {
    x: image.x - surface.x,
    y: image.y - surface.y,
    width: image.width,
    height: image.height,
    pageScale: await loaded.page.evaluate(() => globalThis.visualViewport.scale),
  };
}
async function alignmentSnapshot(loaded, selector) {
  // Resize and scroll repaint the SVG children. Query and measure the live pair in one task.
  return loaded.surface.evaluate(
    ({ image, selector }) => {
      const preview = globalThis.document.querySelector(image).getBoundingClientRect();
      const outline = globalThis.document.querySelector(selector);
      const bounds = outline.getBBox();
      const matrix = outline.getScreenCTM();
      const from = new globalThis.DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
      const to = new globalThis.DOMPoint(
        bounds.x + bounds.width,
        bounds.y + bounds.height,
      ).matrixTransform(matrix);
      return {
        image: { x: preview.x, y: preview.y, width: preview.width, height: preview.height },
        box: { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y },
      };
    },
    { image: loaded.image, selector },
  );
}
async function assertAligned(loaded, selector, bounds) {
  const { image, box } = await alignmentSnapshot(loaded, selector);
  const viewport = loaded.state.viewport;
  for (const [key, value] of Object.entries({
    x: image.x + ((bounds.xMm - viewport.xMm) * image.width) / viewport.widthMm,
    y: image.y + ((bounds.yMm - viewport.yMm) * image.height) / viewport.heightMm,
    width: (bounds.widthMm * image.width) / viewport.widthMm,
    height: (bounds.heightMm * image.height) / viewport.heightMm,
  }))
    assert.ok(
      Math.abs(box[key] - value) < 0.5,
      'The overlay must stay aligned with the visible PNG: ' +
        key +
        ' ' +
        box[key] +
        ' != ' +
        value,
    );
}
function samePose(actual, expected, message) {
  for (const key of ['x', 'y', 'width', 'height', 'pageScale'])
    assert.ok(Math.abs(actual[key] - expected[key]) < 0.1, message + ': ' + key);
}
async function panMouse(loaded, dx = -35, dy = 24) {
  const box = await loaded.surface.locator('#preview-surface').boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await loaded.page.mouse.move(x, y);
  await loaded.page.mouse.down();
  await loaded.page.mouse.move(x + dx, y + dy, { steps: 5 });
  await loaded.page.mouse.up();
}
async function pinch(loaded, factor = 1.5, dx = 0, dy = 0) {
  const box = await loaded.surface.locator('#preview-surface').boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cdp = await loaded.context.newCDPSession(loaded.page);
  const fingers = (distance, tx = 0, ty = 0) => [
    { id: 10, x: x - distance + tx, y: y + ty },
    { id: 20, x: x + distance + tx, y: y + ty },
  ];
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: fingers(35),
    });
    for (let step = 1; step <= 4; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: fingers(
          35 * (1 + ((factor - 1) * step) / 4),
          (dx * step) / 4,
          (dy * step) / 4,
        ),
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}
async function openProperties(loaded, kind) {
  await loaded.surface
    .locator(kind === 'phone' ? '.preview-heading [data-view="edit"]' : '#properties')
    .click();
}
async function closeProperties(loaded, kind) {
  await loaded.surface.locator(kind === 'phone' ? '#close-editor' : '#close-authoring').click();
}

for (const kind of ['phone', 'app']) {
  for (const [width, height] of [
    [360, 640],
    [390, 844],
  ])
    test(
      kind + ' ' + width + '×' + height + ' opens on a visible real artwork canvas',
      async () => {
        const loaded = await loadTouch(browser, kind, realFixture(), width, { height });
        try {
          const image = await loaded.surface.locator(loaded.image).boundingBox();
          assert.equal(
            await loaded.surface.locator(loaded.image).evaluate((item) => item.naturalWidth),
            800,
          );
          assert.ok(image.width >= width * 0.7, 'Artwork should use most of the available width');
          const visibleHeight = Math.max(
            0,
            Math.min(image.y + image.height, height) - Math.max(0, image.y),
          );
          assert.ok(
            visibleHeight >= image.height * 0.95,
            'The initial screen should show the canvas without scrolling past controls',
          );
          await expect(loaded.surface.locator('svg .touch-outline')).toBeVisible();
          await assertAligned(loaded, 'svg .touch-outline', loaded.state.artwork[0].bounds);
          for (const tool of ['select', 'move', 'resize', 'brush', 'rectangle', 'ellipse'])
            await expect(loaded.surface.locator('[data-touch-tool=' + tool + ']')).toBeEnabled();
          assert.deepEqual(loaded.errors, []);
          await capture(loaded.page, 'canvas-' + kind + '-' + width + '-' + height + '-initial');
        } finally {
          await loaded.context.close();
        }
      },
    );

  test(kind + ' Properties keeps the design and direct shape tools visible', async () => {
    const loaded = await loadTouch(browser, kind, realFixture());
    try {
      await openProperties(loaded, kind);
      await expect(loaded.surface.locator('#preview-surface')).toBeVisible();
      for (const tool of ['brush', 'rectangle', 'ellipse'])
        await expect(loaded.surface.locator('[data-touch-tool=' + tool + ']')).toBeVisible();
      await closeProperties(loaded, kind);
      await choose(loaded, 'ellipse');
      await finger(loaded, [
        [30, 30],
        [90, 75],
      ]);
      await expect(loaded.surface.locator('svg ellipse.touch-ghost')).toBeVisible();
      assert.equal(writes(loaded.state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(
    kind + ' rotation retains a finished world-coordinate draft and aligns its overlay',
    async () => {
      const loaded = await loadTouch(browser, kind, realFixture());
      try {
        await choose(loaded, 'rectangle');
        await finger(loaded, [
          [30, 30],
          [90, 75],
        ]);
        await loaded.page.setViewportSize({ width: 844, height: 390 });
        if (kind === 'app')
          await loaded.page.locator('#widget').evaluate((frame) => {
            frame.style.height = '390px';
          });
        await loaded.surface.evaluate(
          () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
        );
        await visibleCanvas(loaded);
        await expect(loaded.surface.locator('svg rect.touch-ghost')).toBeVisible();
        await assertAligned(loaded, 'svg rect.touch-ghost', {
          xMm: 30,
          yMm: 30,
          widthMm: 60,
          heightMm: 45,
        });
        await applyDraft(loaded);
        const [write] = writes(loaded.state);
        assert.equal(write.name, 'add_rectangle');
        for (const [key, value] of Object.entries({ xMm: 30, yMm: 30, widthMm: 60, heightMm: 45 }))
          assert.ok(Math.abs(write.args[key] - value) < 0.001, key + ' changed on rotation');
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(loaded.errors, []);
        await capture(loaded.page, 'canvas-' + kind + '-rotated');
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' Pan drags the actual image with a mouse without sending a design edit',
    async () => {
      const loaded = await loadTouch(browser, kind, realFixture());
      try {
        await choose(loaded, 'pan');
        await visibleCanvas(loaded);
        const before = await pose(loaded);
        await panMouse(loaded);
        const after = await pose(loaded);
        assert.ok(Math.abs(after.x - before.x) >= 20, 'Pan must change the actual scene position');
        assert.ok(Math.abs(after.y - before.y) >= 15, 'Both pan axes should respond');
        assert.equal(after.width, before.width);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' two-finger pinch zooms the scene in a drawing tool without page zoom or writes',
    async () => {
      const loaded = await loadTouch(browser, kind, realFixture());
      try {
        await choose(loaded, 'brush');
        await visibleCanvas(loaded);
        const before = await pose(loaded);
        await pinch(loaded);
        const after = await pose(loaded);
        assert.ok(
          after.width > before.width * 1.25,
          'Pinching should enlarge the actual canvas image',
        );
        assert.ok(
          after.width < before.width * 1.7,
          'Pinch should remain anchored to finger distance',
        );
        assert.equal(after.pageScale, before.pageScale);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind +
      ' completed draft survives Properties and navigation while Apply and PC refresh retain the view',
    async () => {
      const state = realFixture();
      state.onWrite = () => {
        state.preview = previews[1];
      };
      const loaded = await loadTouch(browser, kind, state);
      try {
        await choose(loaded, 'rectangle');
        await finger(loaded, [
          [30, 30],
          [90, 75],
        ]);
        const ghost = loaded.surface.locator('svg rect.touch-ghost');
        await expect(ghost).toBeVisible();
        await openProperties(loaded, kind);
        await closeProperties(loaded, kind);
        await expect(ghost).toBeVisible();
        await visibleCanvas(loaded);
        await pinch(loaded, 1.3, 12, -8);
        await expect(ghost).toBeVisible();
        await expect(loaded.surface.locator('.touch-apply')).toBeEnabled();
        const beforeApply = await pose(loaded);
        await applyDraft(loaded);
        samePose(await pose(loaded), beforeApply, 'Applying a PC edit should retain zoom and pan');
        const [write] = writes(state);
        assert.equal(write.name, 'add_rectangle');
        for (const [key, value] of Object.entries({ xMm: 30, yMm: 30, widthMm: 60, heightMm: 45 }))
          assert.ok(
            Math.abs(write.args[key] - value) < 0.001,
            key + ' must retain its scene coordinate',
          );
        assert.equal(state.edits, 1);
        await choose(loaded, 'pan');
        await panMouse(loaded, -20, 15);
        const beforeRefresh = await pose(loaded);
        state.revision++;
        state.preview = previews[0];
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        samePose(
          await pose(loaded),
          beforeRefresh,
          'A newer compatible PC preview should retain the view',
        );
        assert.equal(writes(state).length, 1);
        assert.deepEqual(loaded.errors, []);
        await capture(loaded.page, 'canvas-' + kind + '-draft-navigation-refresh');
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' adding a second finger during a stroke navigates and cancels only that stroke',
    async () => {
      const loaded = await loadTouch(browser, kind, realFixture());
      try {
        await choose(loaded, 'brush');
        await visibleCanvas(loaded);
        const before = await pose(loaded);
        const box = await loaded.surface.locator('#preview-surface').boundingBox();
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        const cdp = await loaded.context.newCDPSession(loaded.page);
        try {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 10, x: x - 35, y: y - 5 }],
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ id: 10, x: x - 25, y: y + 5 }],
          });
          await expect(loaded.surface.locator('svg polyline.touch-stroke')).toBeVisible();
          await expect(loaded.surface.locator('.touch-apply')).toBeDisabled();
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
              { id: 10, x: x - 25, y: y + 5 },
              { id: 20, x: x + 35, y: y + 5 },
            ],
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { id: 10, x: x - 45, y: y + 5 },
              { id: 20, x: x + 55, y: y + 5 },
            ],
          });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
          await cdp.detach();
        }
        const after = await pose(loaded);
        assert.ok(
          after.width > before.width * 1.3,
          'The existing first finger must join canvas navigation',
        );
        assert.equal(after.pageScale, before.pageScale);
        assert.equal(await loaded.surface.locator('svg polyline.touch-stroke').count(), 0);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind +
      ' fresh PC changes cancel a draft and withdrawing edit permission refuses later drawings',
    async () => {
      const state = realFixture();
      const loaded = await loadTouch(browser, kind, state);
      try {
        await choose(loaded, 'rectangle');
        await finger(loaded, [
          [30, 30],
          [90, 75],
        ]);
        state.revision++;
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(state).length, 0);
        await choose(loaded, 'rectangle');
        await finger(loaded, [
          [30, 30],
          [90, 75],
        ]);
        state.scopes = ['read'];
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        await expect(loaded.surface.locator('[data-touch-tool=rectangle]')).toBeDisabled();
        assert.equal(writes(state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(kind + ' revoked access clears a navigated draft and the private image', async () => {
    const state = realFixture();
    const loaded = await loadTouch(browser, kind, state);
    try {
      await choose(loaded, 'rectangle');
      await finger(loaded, [
        [30, 30],
        [90, 75],
      ]);
      await visibleCanvas(loaded);
      await pinch(loaded, 1.2);
      state.revoked = true;
      await loaded.surface.locator('#refresh').click();
      await idle(loaded.surface);
      assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
      assert.equal(await loaded.surface.locator(loaded.image).getAttribute('src'), null);
      assert.equal(writes(state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}
