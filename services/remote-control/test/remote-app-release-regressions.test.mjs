/* global window, document */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixture, launch } from './remote-app-support.mjs';

let browser;
let script;
let css;
before(async () => {
  browser = await launch();
  css = await readFile(new URL('../app/src/ui/app.css', import.meta.url), 'utf8');
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Controller, controller } from './app/src/core/controller';
        import { store } from './app/src/core/store';
        import { registerViewTools } from './app/src/mcp/app-tools';
        import { Shell } from './app/src/ui/Shell';
        window.subject = { Controller, controller, store, registerViewTools,
          render: () => createRoot(document.getElementById('root')).render(React.createElement(Shell, { phone: null })) };
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  });
  script = bundle.outputFiles[0].text;
});
after(async () => browser?.close());

async function setup(kind = 'phone', width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.route('https://remote.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="root"></div>',
    }),
  );
  await page.goto('https://remote.test/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.evaluate(
    ({ data, kind }) => {
      const { Controller, store } = window.subject;
      data.workspace.revision = 'r1';
      store.reset({ workspace: data.workspace, machine: data.machine, scopes: data.scopes });
      window.data = data;
      window.makeTransport = () => {
        const state = { calls: [], beats: [], releases: 0, pending: [], open: true };
        const transport = {
          kind,
          socketOpen: () => state.open,
          heartbeat: (id) => state.beats.push(id),
          releaseHolds: () => state.releases++,
          subscribe: (listener) => {
            state.emit = listener;
            return () => {
              state.emit = () => {};
            };
          },
          call: async (name, args) => {
            state.calls.push({ name, args });
            if (name === 'get_workspace') return data.workspace;
            if (name === 'get_workspace_scene') return { revision: 'r1', ...data.scene };
            if (name === 'get_machine_status') return data.machine;
            if (name === 'list_fonts') return { fonts: [] };
            if (name === 'list_material_recipes') return { recipes: [] };
            if (name === 'wait_for_change') throw new Error('renderer does not implement tool');
            if (name === 'jog_hold_start')
              return new Promise((resolve) => state.pending.push(resolve));
            return {
              operation: { operationId: args?.operationId ?? args?.requestId, state: 'completed' },
            };
          },
        };
        return { state, transport };
      };
      window.first = window.makeTransport();
      window.control = new Controller();
      window.control.start(window.first.transport);
      window.accept = (index, operationId) =>
        window.first.state.pending[index]({
          operation: { operationId, state: 'running' },
        });
    },
    { data: fixture(), kind },
  );
  return page;
}

for (const cancellation of ['release', 'stop', 'pagehide', 'socket-close', 'hidden']) {
  test(`pending held jog never sends late heartbeats after ${cancellation}`, async () => {
    const page = await setup();
    try {
      await page.evaluate((cancellation) => {
        window.pendingHold = window.control.startHold('x', 1);
        void window.control.startHold('y', 1); // duplicate admission must be suppressed
        if (cancellation === 'release') window.control.stopHold();
        if (cancellation === 'stop') window.control.stop();
        if (cancellation === 'pagehide') window.dispatchEvent(new Event('pagehide'));
        if (cancellation === 'socket-close') {
          window.first.state.open = false;
          window.first.state.emit({ type: 'socket', open: false });
        }
        if (cancellation === 'hidden') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
        }
        window.accept(0, 'released-operation');
      }, cancellation);
      await page.evaluate(() => window.pendingHold);
      await page.clock.runFor(900);
      const result = await page.evaluate(() => window.first.state);
      assert.equal(result.calls.filter((call) => call.name === 'jog_hold_start').length, 1);
      assert.deepEqual(result.beats, []);
      assert.equal(result.releases, 1);
      assert.deepEqual(
        result.calls
          .filter((call) => call.name === 'jog_hold_stop')
          .map((call) => call.args.operationId),
        ['released-operation'],
      );
      assert.equal(await page.evaluate(() => window.control.holdActive()), false);
    } finally {
      await page.close();
    }
  });
}

test('old admission cannot heartbeat or release a new gesture or replacement transport', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.oldHold = window.control.startHold('x', 1);
      window.second = window.makeTransport();
      window.control.start(window.second.transport);
      window.newHold = window.control.startHold('y', 1);
      window.second.state.pending[0]({ operation: { operationId: 'new', state: 'running' } });
    });
    await page.evaluate(() => window.newHold);
    await page.evaluate(() => window.accept(0, 'old'));
    await page.evaluate(() => window.oldHold);
    await page.clock.runFor(450);
    let result = await page.evaluate(() => ({
      old: window.first.state,
      next: window.second.state,
    }));
    assert.deepEqual(result.old.beats, []);
    assert.deepEqual(
      result.old.calls
        .filter((call) => call.name === 'jog_hold_stop')
        .map((call) => call.args.operationId),
      ['old'],
    );
    assert.ok(result.next.beats.length >= 3);
    assert.ok(result.next.beats.every((id) => id === 'new'));
    assert.equal(result.next.releases, 0);
    await page.evaluate(() => window.control.stopHold());
    const count = result.next.beats.length;
    await page.clock.runFor(450);
    result = await page.evaluate(() => window.second.state);
    assert.equal(result.beats.length, count);
    assert.equal(result.releases, 1);
  } finally {
    await page.close();
  }
});

for (const kind of ['phone', 'mcp']) {
  test(`${kind}: missing change-counter support keeps status polling`, async () => {
    const page = await setup(kind);
    try {
      await page.evaluate(() => {
        window.first.state.emit({ type: 'socket', open: true });
        window.data.machine = {
          ...window.data.machine,
          job: { active: true, state: 'running', progressPercent: 99 },
        };
      });
      await page.clock.runFor(5500);
      const state = await page.evaluate(() => ({
        machine: window.subject.store.get().machine,
        live: window.subject.store.get().liveUpdates,
        calls: window.first.state.calls,
      }));
      assert.equal(state.machine.job.progressPercent, 99);
      assert.equal(state.live, false);
      assert.ok(state.calls.filter((call) => call.name === 'get_machine_status').length >= 2);
    } finally {
      await page.close();
    }
  });
}

test('confirmed socket counters stop fallback polling until the connection is lost', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.first.state.emit({ type: 'socket', open: true });
      window.first.state.emit({ type: 'changed', revision: 'r1', machineSeq: 1 });
    });
    await page.clock.runFor(1500);
    const before = await page.evaluate(() => window.first.state.calls.length);
    await page.clock.runFor(5500);
    assert.equal(await page.evaluate(() => window.first.state.calls.length), before);
    assert.equal(await page.evaluate(() => window.subject.store.get().liveUpdates), true);
    await page.evaluate(() => window.first.state.emit({ type: 'socket', open: false }));
    await page.clock.runFor(5500);
    assert.ok((await page.evaluate(() => window.first.state.calls.length)) > before);
  } finally {
    await page.close();
  }
});

for (const width of [320, 900]) {
  test(`Abort stays clickable above the layer sheet at ${width}px`, async () => {
    const page = await setup('phone', width);
    try {
      await page.evaluate(() => {
        window.control.stop();
        window.subject.controller.start(window.first.transport);
        window.data.machine.job = { active: true, state: 'running' };
        window.subject.store.set({ tab: 'layers', machine: { ...window.data.machine } });
        window.subject.render();
      });
      await page.getByRole('button', { name: 'Edit layer', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.clock.runFor(250);
      await page.getByRole('button', { name: 'Abort', exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => window.first.state.calls.filter((call) => call.name === 'abort_job').length,
        ),
        1,
      );
      const boxes = await page.evaluate(() => ({
        sheet: document.querySelector('.sheet').getBoundingClientRect().bottom,
        dock: document.querySelector('.abort-dock').getBoundingClientRect().top,
      }));
      assert.ok(boxes.sheet <= boxes.dock + 1, JSON.stringify(boxes));
    } finally {
      await page.close();
    }
  });
}

for (const initialView of [null, { x: 12345, y: 54321, scale: 0.001 }]) {
  test(`ui_focus mounts Design and retains focus (initial view ${initialView === null ? 'unset' : 'set'})`, async () => {
    const page = await setup();
    try {
      await page.evaluate((initialView) => {
        window.subject.store.set({ tab: 'layers', view: initialView });
        window.subject.render();
        const tools = {};
        window.subject.registerViewTools(
          {
            registerTool: (name, _schema, run) => {
              tools[name] = run;
            },
          },
          async () => {},
        );
        window.focusArtwork = () => tools.ui_focus({ artworkIds: ['a1'] });
      }, initialView);
      await page.getByRole('button', { name: 'Edit layer', exact: true }).waitFor();
      assert.equal(await page.locator('.canvas-wrap').count(), 0);
      await page.evaluate(() => window.focusArtwork());
      await page.clock.runFor(500);
      const result = await page.evaluate(() => window.subject.store.get());
      assert.equal(result.tab, 'design');
      assert.ok(result.view.scale > 1);
      assert.notEqual(result.view.x, 12345);
      assert.deepEqual(result.selection, []);
    } finally {
      await page.close();
    }
  });
}
