/* global window */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixture, respond } from './remote-app-support.mjs';

let bundle;
export function canvasFixture() {
  const state = fixture();
  const items = [
    ['a1', 'group', 20, true, true],
    ['a2', 'group', 60, true, true],
    ['b', 'b', 130, true, true],
    ['hidden', 'hidden', 190, false, true],
    ['locked', 'locked', 240, true, false],
  ];
  state.workspace.artwork = items.map(([id, , xMm, visible, editable]) => ({
    id,
    type: 'shape',
    name: id,
    visible,
    editable,
    bounds: { xMm, yMm: 30, widthMm: 20, heightMm: 20 },
  }));
  state.workspace.totalArtwork = items.length;
  state.scene.objects = items
    .filter(([, , , visible]) => visible)
    .map(([id, unitId, xMm, , editable]) => ({
      id,
      unitId,
      kind: 'shape',
      editable,
      bounds: { xMm, yMm: 30, widthMm: 20, heightMm: 20 },
      paths: [
        {
          color: '#b2603a',
          fill: true,
          output: true,
          polylines: [{ closed: true, points: `${xMm * 100},3000 2000,0 0,2000 -2000,0` }],
        },
      ],
    }));
  return state;
}

async function sourceBundle() {
  if (bundle !== undefined) return bundle;
  const built = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { controller } from './app/src/core/controller';
        import { store } from './app/src/core/store';
        import { Shell } from './app/src/ui/Shell';
        window.subject = { controller, store, render: () =>
          createRoot(document.getElementById('root')).render(React.createElement(Shell, {phone: null})) };
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  });
  bundle = built.outputFiles[0].text;
  return bundle;
}

export async function loadCanvas(browser, state = canvasFixture(), width = 900) {
  const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.exposeFunction('backend', async (name, args) => {
    state.commands.push({ name, args });
    if (name === 'apply_edits') {
      for (const edit of args.edits ?? []) {
        if (edit.command === 'set_selection') state.workspace.selection = edit.args.artworkIds;
      }
    }
    return respond(state, name, args);
  });
  await page.route('https://canvas.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  );
  await page.goto('https://canvas.test/');
  await page.clock.install();
  await page.addStyleTag({
    content: await readFile(new URL('../app/src/ui/app.css', import.meta.url), 'utf8'),
  });
  await page.addScriptTag({ content: await sourceBundle() });
  await page.evaluate((scopes) => {
    window.subject.store.reset({ host: 'mcp', displayMode: 'fullscreen', scopes });
    window.transport = {
      kind: 'mcp',
      socketOpen: () => false,
      heartbeat: () => {},
      releaseHolds: () => {},
      subscribe: () => () => {},
      call: (name, args = {}) =>
        name === 'wait_for_change'
          ? Promise.reject(new Error('unsupported'))
          : window.backend(name, args),
    };
    window.subject.controller.start(window.transport);
    window.subject.render();
  }, state.scopes);
  await page.locator('.art-path').last().waitFor();
  return { page, context, state, errors };
}

export async function point(page, x, y) {
  return page.locator('.canvas-wrap svg').evaluate(
    (svg, [x, y]) => {
      const p = svg.createSVGPoint();
      p.x = x;
      p.y = y;
      const result = p.matrixTransform(svg.getScreenCTM());
      return { x: result.x, y: result.y };
    },
    [x, y],
  );
}

export async function clickItem(page, id = 'a1', touch = false) {
  const x = { a1: 30, a2: 70, b: 140, hidden: 200, locked: 250 }[id];
  const at = await point(page, x, 40);
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

export async function drag(page, from, to, button = 'left') {
  const a = await point(page, ...from),
    b = await point(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up({ button });
}

export const selected = (page) =>
  page.evaluate(() => [...window.subject.store.get().selection].sort());
export const mutations = (state) =>
  state.commands.filter(
    (item) =>
      item.name === 'transform_artwork' ||
      item.name === 'apply_edits' ||
      item.name === 'arrange_artwork',
  );
